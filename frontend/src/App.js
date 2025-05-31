import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API_BASE_URL = process.env.REACT_APP_BACKEND_URL;

function App() {
  const [activeTab, setActiveTab] = useState('generate');
  const [prompt, setPrompt] = useState('');
  const [selectedStyles, setSelectedStyles] = useState([]);
  const [imagesPerStyle, setImagesPerStyle] = useState(4);
  const [authCookie, setAuthCookie] = useState(localStorage.getItem('authCookie') || '_U=');
  const [availableStyles, setAvailableStyles] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSessions, setGenerationSessions] = useState([]);
  const [batchFile, setBatchFile] = useState(null);
  const [batchPrompts, setBatchPrompts] = useState([]);
  const [cookieValid, setCookieValid] = useState(null);
  const [settings, setSettings] = useState({
    storagePath: '/tmp/pixel_images',
    imagesPerStyle: 4
  });

  // Load available styles on component mount
  useEffect(() => {
    loadStyles();
    loadSessions();
    testCookie();
  }, []);

  // Save auth cookie to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('authCookie', authCookie);
  }, [authCookie]);

  const loadStyles = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/styles`);
      setAvailableStyles(response.data.styles);
    } catch (error) {
      console.error('Failed to load styles:', error);
    }
  };

  const loadSessions = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/sessions`);
      setGenerationSessions(response.data);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  };

  const testCookie = async () => {
    try {
      const response = await axios.post(`${API_BASE_URL}/api/test-cookie`, {
        cookie: authCookie
      });
      setCookieValid(response.data.valid);
    } catch (error) {
      setCookieValid(false);
      console.error('Cookie test failed:', error);
    }
  };

  const handleStyleToggle = (style) => {
    setSelectedStyles(prev => 
      prev.includes(style) 
        ? prev.filter(s => s !== style)
        : [...prev, style]
    );
  };

  const handleSelectAllStyles = () => {
    setSelectedStyles(availableStyles);
  };

  const handleClearStyles = () => {
    setSelectedStyles([]);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      alert('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/generate`, {
        prompt: prompt.trim(),
        styles: selectedStyles.length > 0 ? selectedStyles : null,
        images_per_style: imagesPerStyle,
        auth_cookie: authCookie
      });

      // Add to sessions list
      const newSession = {
        id: response.data.session_id,
        prompt: prompt.trim(),
        styles: selectedStyles,
        images_per_style: imagesPerStyle,
        total_images: response.data.total_images,
        status: 'processing',
        images: [],
        created_at: new Date().toISOString()
      };
      
      setGenerationSessions(prev => [newSession, ...prev]);
      
      // Switch to gallery tab to see progress
      setActiveTab('gallery');
      
      // Poll for updates
      pollSessionStatus(response.data.session_id);
      
    } catch (error) {
      alert('Generation failed: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleBatchGenerate = async () => {
    if (batchPrompts.length === 0) {
      alert('Please upload a file with prompts or add prompts manually');
      return;
    }

    setIsGenerating(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/api/generate-batch`, {
        prompts: batchPrompts,
        styles: selectedStyles.length > 0 ? selectedStyles : null,
        images_per_style: imagesPerStyle,
        auth_cookie: authCookie
      });

      // Add sessions to list
      for (const sessionData of response.data.sessions) {
        const newSession = {
          id: sessionData.session_id,
          prompt: sessionData.prompt,
          styles: selectedStyles,
          images_per_style: imagesPerStyle,
          total_images: (selectedStyles.length || 1) * imagesPerStyle,
          status: 'processing',
          images: [],
          created_at: new Date().toISOString()
        };
        
        setGenerationSessions(prev => [newSession, ...prev]);
        pollSessionStatus(sessionData.session_id);
      }
      
      // Switch to gallery tab
      setActiveTab('gallery');
      
    } catch (error) {
      alert('Batch generation failed: ' + (error.response?.data?.detail || error.message));
    } finally {
      setIsGenerating(false);
    }
  };

  const pollSessionStatus = async (sessionId) => {
    const maxRetries = 60; // 10 minutes with 10-second intervals
    let retries = 0;

    const poll = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/session/${sessionId}`);
        const session = response.data;

        setGenerationSessions(prev => 
          prev.map(s => s.id === sessionId ? session : s)
        );

        if (session.status === 'processing' && retries < maxRetries) {
          retries++;
          setTimeout(poll, 10000); // Poll every 10 seconds
        }
      } catch (error) {
        console.error('Failed to poll session status:', error);
      }
    };

    poll();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setBatchFile(file);
    
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await axios.post(`${API_BASE_URL}/api/upload-prompts`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setBatchPrompts(response.data.prompts);
    } catch (error) {
      alert('Failed to parse file: ' + (error.response?.data?.detail || error.message));
    }
  };

  const downloadImage = async (imageId) => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/image/${imageId}`, {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `pixel_image_${imageId}.png`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      alert('Failed to download image: ' + (error.response?.data?.detail || error.message));
    }
  };

  const renderGenerateTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Generate Images</h2>
        
        {/* Cookie Status */}
        <div className="mb-4 p-3 rounded-lg border">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Cookie Status:</span>
            <span className={`text-sm px-2 py-1 rounded ${
              cookieValid === true ? 'bg-green-100 text-green-800' :
              cookieValid === false ? 'bg-red-100 text-red-800' :
              'bg-yellow-100 text-yellow-800'
            }`}>
              {cookieValid === true ? 'Valid' : cookieValid === false ? 'Invalid' : 'Testing...'}
            </span>
          </div>
        </div>

        {/* Prompt Input */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Prompt
          </label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows="3"
            placeholder="Enter your image description..."
          />
        </div>

        {/* Images Per Style */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Images Per Style
          </label>
          <select
            value={imagesPerStyle}
            onChange={(e) => setImagesPerStyle(parseInt(e.target.value))}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        {/* Style Selection */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">
              Styles ({selectedStyles.length} selected)
            </label>
            <div className="space-x-2">
              <button
                onClick={handleSelectAllStyles}
                className="text-sm px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              >
                Select All
              </button>
              <button
                onClick={handleClearStyles}
                className="text-sm px-3 py-1 bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Clear
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
            {availableStyles.map((style) => (
              <label key={style} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                <input
                  type="checkbox"
                  checked={selectedStyles.includes(style)}
                  onChange={() => handleStyleToggle(style)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{style}</span>
              </label>
            ))}
          </div>
          {selectedStyles.length === 0 && (
            <p className="text-sm text-gray-500 mt-2">No styles selected - will generate without style modifiers</p>
          )}
        </div>

        {/* Total Images Preview */}
        <div className="mb-6 p-3 bg-blue-50 rounded-lg">
          <p className="text-sm text-blue-800">
            <strong>Total images to generate:</strong> {(selectedStyles.length || 1) * imagesPerStyle}
          </p>
        </div>

        {/* Generate Button */}
        <button
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
          className="w-full py-3 px-6 bg-gradient-to-r from-purple-500 to-pink-500 text-white font-medium rounded-lg hover:from-purple-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {isGenerating ? 'Generating...' : 'Generate Images'}
        </button>
      </div>
    </div>
  );

  const renderBatchTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Batch Generation</h2>
        
        {/* File Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Upload Prompts File (.txt or .csv)
          </label>
          <input
            type="file"
            accept=".txt,.csv"
            onChange={handleFileUpload}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          />
          {batchFile && (
            <p className="text-sm text-gray-600 mt-2">
              Uploaded: {batchFile.name} ({batchPrompts.length} prompts)
            </p>
          )}
        </div>

        {/* Prompts Preview */}
        {batchPrompts.length > 0 && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Prompts Preview
            </label>
            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3 bg-gray-50">
              {batchPrompts.slice(0, 10).map((prompt, index) => (
                <div key={index} className="text-sm text-gray-700 py-1">
                  {index + 1}. {prompt}
                </div>
              ))}
              {batchPrompts.length > 10 && (
                <div className="text-sm text-gray-500 py-1">
                  ... and {batchPrompts.length - 10} more prompts
                </div>
              )}
            </div>
          </div>
        )}

        {/* Style Selection for Batch */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <label className="block text-sm font-medium text-gray-700">
              Styles for All Prompts ({selectedStyles.length} selected)
            </label>
            <div className="space-x-2">
              <button
                onClick={handleSelectAllStyles}
                className="text-sm px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200"
              >
                Select All
              </button>
              <button
                onClick={handleClearStyles}
                className="text-sm px-3 py-1 bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
              >
                Clear
              </button>
            </div>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto border border-gray-200 rounded-lg p-3">
            {availableStyles.map((style) => (
              <label key={style} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                <input
                  type="checkbox"
                  checked={selectedStyles.includes(style)}
                  onChange={() => handleStyleToggle(style)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">{style}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Images Per Style */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Images Per Style
          </label>
          <select
            value={imagesPerStyle}
            onChange={(e) => setImagesPerStyle(parseInt(e.target.value))}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        {/* Batch Summary */}
        {batchPrompts.length > 0 && (
          <div className="mb-6 p-4 bg-blue-50 rounded-lg">
            <h3 className="font-medium text-blue-800 mb-2">Batch Summary:</h3>
            <ul className="text-sm text-blue-700 space-y-1">
              <li>• {batchPrompts.length} prompts</li>
              <li>• {selectedStyles.length || 1} style{selectedStyles.length !== 1 ? 's' : ''} per prompt</li>
              <li>• {imagesPerStyle} image{imagesPerStyle !== 1 ? 's' : ''} per style</li>
              <li>• <strong>Total: {batchPrompts.length * (selectedStyles.length || 1) * imagesPerStyle} images</strong></li>
            </ul>
          </div>
        )}

        {/* Generate Batch Button */}
        <button
          onClick={handleBatchGenerate}
          disabled={isGenerating || batchPrompts.length === 0}
          className="w-full py-3 px-6 bg-gradient-to-r from-green-500 to-blue-500 text-white font-medium rounded-lg hover:from-green-600 hover:to-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
        >
          {isGenerating ? 'Processing Batch...' : 'Generate Batch'}
        </button>
      </div>
    </div>
  );

  const renderGalleryTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-gray-800">Image Gallery</h2>
          <button
            onClick={loadSessions}
            className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
          >
            Refresh
          </button>
        </div>

        {generationSessions.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No generation sessions yet. Create some images to see them here!</p>
          </div>
        ) : (
          <div className="space-y-6">
            {generationSessions.map((session) => (
              <div key={session.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="font-medium text-gray-800">{session.prompt}</h3>
                    <p className="text-sm text-gray-600">
                      {session.styles?.length > 0 ? session.styles.join(', ') : 'No styles'} • 
                      {session.completed_images || 0}/{session.total_images} completed
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm ${
                    session.status === 'completed' ? 'bg-green-100 text-green-800' :
                    session.status === 'processing' ? 'bg-blue-100 text-blue-800' :
                    session.status === 'failed' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {session.status}
                  </span>
                </div>

                {session.images && session.images.length > 0 && (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {session.images.map((image) => (
                      <div key={image.id} className="relative group">
                        <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                          {image.status === 'completed' ? (
                            <img
                              src={`${API_BASE_URL}/api/image/${image.id}`}
                              alt={`Generated: ${session.prompt}`}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik04MCA4MEw4MCA4MEw5Ni44IDYzLjJMMTIwIDg2LjRMMTM2IDcwLjRMMTYwIDk0LjRWMTIwSDQwVjEwMC44TDgwIDgwWiIgZmlsbD0iI0Q5REZFQSIvPgo8L3N2Zz4K';
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <div className="text-center">
                                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2"></div>
                                <p className="text-xs text-gray-500">{image.status}</p>
                              </div>
                            </div>
                          )}
                        </div>
                        {image.status === 'completed' && (
                          <button
                            onClick={() => downloadImage(image.id)}
                            className="absolute top-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                          >
                            ⬇
                          </button>
                        )}
                        <div className="mt-2">
                          <p className="text-xs text-gray-600 font-medium">
                            {image.style || 'No style'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {(!session.images || session.images.length === 0) && session.status === 'processing' && (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
                    <p className="text-gray-600">Generating images...</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  const renderSettingsTab = () => (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow-md p-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Settings</h2>
        
        {/* Authentication Cookie */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Bing Authentication Cookie
          </label>
          <div className="flex space-x-2">
            <input
              type="password"
              value={authCookie}
              onChange={(e) => setAuthCookie(e.target.value)}
              className="flex-1 p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="_U=your_cookie_value"
            />
            <button
              onClick={testCookie}
              className="px-4 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
            >
              Test
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Get your cookie from Bing Image Creator while logged in. Look for the '_U' cookie value.
          </p>
          {cookieValid !== null && (
            <p className={`text-sm mt-2 ${cookieValid ? 'text-green-600' : 'text-red-600'}`}>
              {cookieValid ? '✓ Cookie is valid' : '✗ Cookie is invalid or expired'}
            </p>
          )}
        </div>

        {/* Storage Path */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Storage Path
          </label>
          <input
            type="text"
            value={settings.storagePath}
            onChange={(e) => setSettings(prev => ({ ...prev, storagePath: e.target.value }))}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            placeholder="/tmp/pixel_images"
          />
          <p className="text-xs text-gray-500 mt-2">
            Directory where generated images will be stored on the server.
          </p>
        </div>

        {/* Default Images Per Style */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Default Images Per Style
          </label>
          <select
            value={settings.imagesPerStyle}
            onChange={(e) => setSettings(prev => ({ ...prev, imagesPerStyle: parseInt(e.target.value) }))}
            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="font-medium text-blue-800 mb-2">How to get your Bing Cookie:</h3>
          <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
            <li>Go to <a href="https://www.bing.com/images/create" target="_blank" rel="noopener noreferrer" className="underline">Bing Image Creator</a></li>
            <li>Log in with your Microsoft account</li>
            <li>Open browser developer tools (F12)</li>
            <li>Go to Application/Storage → Cookies → bing.com</li>
            <li>Find the '_U' cookie and copy its value</li>
            <li>Paste it in the field above (include '_U=' prefix)</li>
          </ol>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-100 to-pink-100">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg"></div>
              <h1 className="text-xl font-bold text-gray-900">Pixel's DALL-E Generator</h1>
            </div>
            <div className="text-sm text-gray-500">
              v1.0.0 by PrimalCore
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Tab Navigation */}
        <div className="bg-white rounded-lg shadow-sm mb-6">
          <nav className="flex space-x-8 px-6" aria-label="Tabs">
            {[
              { id: 'generate', name: 'Generate', icon: '🎨' },
              { id: 'batch', name: 'Batch', icon: '📁' },
              { id: 'gallery', name: 'Gallery', icon: '🖼️' },
              { id: 'settings', name: 'Settings', icon: '⚙️' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === tab.id
                    ? 'border-purple-500 text-purple-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <span className="mr-2">{tab.icon}</span>
                {tab.name}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab Content */}
        {activeTab === 'generate' && renderGenerateTab()}
        {activeTab === 'batch' && renderBatchTab()}
        {activeTab === 'gallery' && renderGalleryTab()}
        {activeTab === 'settings' && renderSettingsTab()}
      </div>
    </div>
  );
}

export default App;
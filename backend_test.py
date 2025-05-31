import requests
import unittest
import os
import json
from datetime import datetime

class PixelDalleAPITester(unittest.TestCase):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # Get the backend URL from the frontend .env file
        self.base_url = "https://e813e82c-a3eb-41be-89ba-0d3517b4f78f.preview.emergentagent.com"
        self.api_url = f"{self.base_url}/api"
        print(f"Testing API at: {self.api_url}")
        
        # Create a test prompts file
        self.create_test_prompts_file()

    def create_test_prompts_file(self):
        """Create a test prompts file for batch testing"""
        self.test_file_path = "/tmp/test_prompts.txt"
        with open(self.test_file_path, "w") as f:
            f.write("a beautiful sunset over mountains\na cat wearing a wizard hat\na futuristic city with flying cars")
        print(f"Created test prompts file at {self.test_file_path}")

    def test_01_root_endpoint(self):
        """Test the root API endpoint"""
        print("\n🔍 Testing root endpoint...")
        response = requests.get(f"{self.api_url}/")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("message", data)
        print(f"✅ Root endpoint response: {data}")

    def test_02_styles_endpoint(self):
        """Test the styles endpoint"""
        print("\n🔍 Testing styles endpoint...")
        response = requests.get(f"{self.api_url}/styles")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("styles", data)
        self.assertEqual(len(data["styles"]), 24)  # Should have 24 styles
        print(f"✅ Styles endpoint returned {len(data['styles'])} styles")
        print(f"Styles: {data['styles']}")

    def test_03_test_cookie_endpoint(self):
        """Test the cookie test endpoint"""
        print("\n🔍 Testing cookie test endpoint...")
        # Test with a sample cookie (will likely be invalid)
        test_cookie = "_U=sample_cookie_value"
        response = requests.post(
            f"{self.api_url}/test-cookie", 
            json={"cookie": test_cookie}
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("valid", data)
        print(f"✅ Cookie test response: {data}")

    def test_04_sessions_endpoint(self):
        """Test the sessions endpoint"""
        print("\n🔍 Testing sessions endpoint...")
        response = requests.get(f"{self.api_url}/sessions")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIsInstance(data, list)
        print(f"✅ Sessions endpoint returned {len(data)} sessions")

    def test_05_upload_prompts_endpoint(self):
        """Test the upload prompts endpoint"""
        print("\n🔍 Testing upload prompts endpoint...")
        with open(self.test_file_path, "rb") as f:
            files = {"file": ("test_prompts.txt", f, "text/plain")}
            response = requests.post(f"{self.api_url}/upload-prompts", files=files)
        
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("prompts", data)
        self.assertIn("count", data)
        self.assertEqual(data["count"], 3)  # Should have 3 prompts
        print(f"✅ Upload prompts response: {data}")

def run_tests():
    """Run all the API tests"""
    test_suite = unittest.TestSuite()
    test_suite.addTest(PixelDalleAPITester('test_01_root_endpoint'))
    test_suite.addTest(PixelDalleAPITester('test_02_styles_endpoint'))
    test_suite.addTest(PixelDalleAPITester('test_03_test_cookie_endpoint'))
    test_suite.addTest(PixelDalleAPITester('test_04_sessions_endpoint'))
    test_suite.addTest(PixelDalleAPITester('test_05_upload_prompts_endpoint'))
    
    runner = unittest.TextTestRunner(verbosity=2)
    runner.run(test_suite)

if __name__ == "__main__":
    run_tests()

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.responses import FileResponse, StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import aiofiles
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime
import requests
import random
import re
import time
from urllib.parse import quote
from http.cookies import SimpleCookie
import asyncio
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Pixel's DALL-E Image Generator API", version="1.0.0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configuration
BING_URL = "https://www.bing.com"
STORAGE_DIR = Path("/tmp/pixel_images")
STORAGE_DIR.mkdir(exist_ok=True)

# Available styles
ALL_STYLES = [
    "watercolor", "oil painting", "cyberpunk", "steampunk", "cartoon", "anime",
    "photorealistic", "pixel art", "low poly", "noir", "futuristic", "retro",
    "fantasy", "impressionist", "Van Gogh", "Picasso", "minimalist", "surreal",
    "vaporwave", "gothic", "pop art", "comic book", "sketch", "chibi"
]

SENSITIVE_WORDS = {"porn", "sex", "naked", "kill", "drug", "gore"}

# Models
class UserSettings(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    auth_cookie: str = "_U="
    storage_path: str = "/tmp/pixel_images"
    images_per_style: int = 4
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

class GenerationRequest(BaseModel):
    prompt: str
    styles: Optional[List[str]] = None
    images_per_style: int = 4
    auth_cookie: Optional[str] = None

class BatchGenerationRequest(BaseModel):
    prompts: List[str]
    styles: Optional[List[str]] = None
    images_per_style: int = 4
    auth_cookie: Optional[str] = None

class GeneratedImage(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    prompt: str
    style: Optional[str] = None
    image_url: str
    local_path: Optional[str] = None
    status: str = "pending"  # pending, completed, failed
    created_at: datetime = Field(default_factory=datetime.utcnow)

class GenerationSession(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    prompt: str
    styles: List[str]
    images_per_style: int
    total_images: int
    completed_images: int = 0
    failed_images: int = 0
    status: str = "pending"  # pending, processing, completed, failed
    images: List[GeneratedImage] = []
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

# Core Image Generator Class
class PixelDalleGenerator:
    def __init__(self, auth_cookie: str):
        self.auth_cookie = auth_cookie
        self.session = requests.Session()
        self.headers = {
            "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "no-cache",
            "content-type": "application/x-www-form-urlencoded",
            "referer": "https://www.bing.com/images/create/",
            "origin": "https://www.bing.com",
            "user-agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0"
            ),
            "x-forwarded-for": f"13.{random.randint(104, 107)}.{random.randint(0, 255)}.{random.randint(0, 255)}",
        }
        self.session.headers.update(self.headers)
        self.session.cookies.update(self._parse_cookie_string(auth_cookie))

    def _parse_cookie_string(self, cookie_string):
        cookie = SimpleCookie()
        cookie.load(cookie_string)
        return {key: morsel.value for key, morsel in cookie.items()}

    async def test_cookie(self):
        try:
            response = self.session.get(f"{BING_URL}/images/create", timeout=30)
            if response.status_code == 200 and "create" in response.url:
                self.session.cookies.update(response.cookies)
                return True
            return False
        except Exception:
            return False

    def _contains_sensitive_words(self, prompt):
        prompt_lower = prompt.lower()
        for word in SENSITIVE_WORDS:
            if word in prompt_lower:
                return True, word
        return False, None

    async def generate_images(self, prompt: str, styles: List[str] = None, images_per_style: int = 4):
        if not prompt:
            raise ValueError("Prompt cannot be empty.")
        
        blocked, word = self._contains_sensitive_words(prompt)
        if blocked:
            raise ValueError(f"Blocked due to sensitive content: {word}")

        styles = styles or [None]
        all_image_links = []

        for style in styles:
            styled_prompt = f"{prompt}, {style}" if style else prompt
            try:
                image_links = await self._generate_for_style(styled_prompt, images_per_style)
                for i, link in enumerate(image_links[:images_per_style]):
                    all_image_links.append({
                        "url": link,
                        "style": style,
                        "index": i
                    })
            except Exception as e:
                logging.error(f"Error generating for style '{style}': {str(e)}")
                continue

        return all_image_links

    async def _generate_for_style(self, styled_prompt: str, images_per_style: int):
        url_encoded_prompt = quote(styled_prompt)
        payload = f"q={url_encoded_prompt}&qs=ds"

        # Preload to capture cookies
        preload_response = self.session.get(f"{BING_URL}/images/create", timeout=30)
        if preload_response.status_code == 200:
            self.session.cookies.update(preload_response.cookies)

        # Try POST with different rt parameters
        for rt in ["4", "3", None]:
            url = f"{BING_URL}/images/create?q={url_encoded_prompt}&FORM=GENCRE"
            if rt:
                url += f"&rt={rt}"
            
            response = self.session.post(url, allow_redirects=False, data=payload, timeout=600)
            
            if "this prompt has been blocked" in response.text.lower():
                raise ValueError("Prompt blocked due to sensitive content")
            
            if response.status_code == 302:
                redirect_url = response.headers["Location"].replace("&nfy=1", "")
                request_id = redirect_url.split("id=")[-1]
                self.session.get(f"{BING_URL}{redirect_url}")
                polling_url = f"{BING_URL}/images/create/async/results/{request_id}?q={url_encoded_prompt}"
                return await self._poll_images(polling_url, images_per_style)

        # Fallback to GET if POST fails
        return await self._fallback_get_images(url_encoded_prompt, images_per_style)

    async def _poll_images(self, polling_url: str, images_per_style: int):
        start_time = time.time()
        while time.time() - start_time < 600:  # 10 minute timeout
            try:
                response = self.session.get(polling_url, timeout=30)
                if response.status_code == 200 and "errorMessage" not in response.text:
                    image_links = re.findall(r'src="([^"]+)"', response.text)
                    links = [link.split("?w=")[0] for link in image_links if "?w=" in link]
                    links = list(set(links))
                    if links:
                        return links[:images_per_style]
                await asyncio.sleep(1)
            except Exception:
                await asyncio.sleep(2)
        raise TimeoutError("Request timed out after 10 minutes")

    async def _fallback_get_images(self, url_encoded_prompt: str, images_per_style: int):
        response = self.session.get(
            f"{BING_URL}/images/create?q={url_encoded_prompt}&FORM=GENCRE", timeout=600
        )
        
        image_links = re.findall(r'src="([^"]+)"', response.text)
        normal_image_links = [
            link.split("?w=")[0] for link in image_links if "?w=" in link and link.startswith("https")
        ]
        normal_image_links = list(set(normal_image_links))
        if normal_image_links:
            return normal_image_links[:images_per_style]
        
        raise ValueError("No images found in response")

    async def download_image(self, url: str, filepath: str):
        try:
            response = self.session.get(url, timeout=30)
            if response.status_code == 200:
                async with aiofiles.open(filepath, "wb") as f:
                    await f.write(response.content)
                return True
        except Exception as e:
            logging.error(f"Failed to download image: {str(e)}")
        return False

# API Routes
@api_router.get("/")
async def root():
    return {"message": "Pixel's DALL-E Image Generator API v1.0.0"}

@api_router.get("/styles")
async def get_styles():
    return {"styles": ALL_STYLES}

@api_router.post("/settings")
async def save_settings(settings: UserSettings):
    settings.updated_at = datetime.utcnow()
    await db.user_settings.replace_one(
        {"id": settings.id}, 
        settings.dict(), 
        upsert=True
    )
    return settings

@api_router.get("/settings/{user_id}")
async def get_settings(user_id: str):
    settings = await db.user_settings.find_one({"id": user_id})
    if not settings:
        # Return default settings
        default_settings = UserSettings(id=user_id)
        return default_settings
    return UserSettings(**settings)

@api_router.post("/generate")
async def generate_images(request: GenerationRequest, background_tasks: BackgroundTasks):
    # Validate request
    if not request.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt cannot be empty")
    
    if request.images_per_style > 4:
        raise HTTPException(status_code=400, detail="Images per style cannot exceed 4")

    # Create generation session
    session = GenerationSession(
        prompt=request.prompt,
        styles=request.styles or [],
        images_per_style=request.images_per_style,
        total_images=len(request.styles or [None]) * request.images_per_style
    )
    
    # Save session to database
    await db.generation_sessions.insert_one(session.dict())
    
    # Start background generation
    background_tasks.add_task(
        process_generation,
        session.id,
        request.prompt,
        request.styles or [],
        request.images_per_style,
        request.auth_cookie or "_U="
    )
    
    return {
        "session_id": session.id,
        "status": "processing",
        "total_images": session.total_images
    }

@api_router.post("/generate-batch")
async def generate_batch(request: BatchGenerationRequest, background_tasks: BackgroundTasks):
    if not request.prompts:
        raise HTTPException(status_code=400, detail="No prompts provided")
    
    sessions = []
    for prompt in request.prompts:
        if prompt.strip():
            session = GenerationSession(
                prompt=prompt,
                styles=request.styles or [],
                images_per_style=request.images_per_style,
                total_images=len(request.styles or [None]) * request.images_per_style
            )
            sessions.append(session)
    
    # Save all sessions
    if sessions:
        await db.generation_sessions.insert_many([s.dict() for s in sessions])
        
        # Start background processing for each
        for session in sessions:
            background_tasks.add_task(
                process_generation,
                session.id,
                session.prompt,
                session.styles,
                session.images_per_style,
                request.auth_cookie or "_U="
            )
    
    return {
        "batch_id": str(uuid.uuid4()),
        "sessions": [{"session_id": s.id, "prompt": s.prompt} for s in sessions],
        "total_sessions": len(sessions)
    }

@api_router.get("/session/{session_id}")
async def get_session(session_id: str):
    session = await db.generation_sessions.find_one({"id": session_id})
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return GenerationSession(**session)

@api_router.get("/sessions")
async def get_sessions(limit: int = 50):
    sessions = await db.generation_sessions.find().sort("created_at", -1).limit(limit).to_list(limit)
    return [GenerationSession(**session) for session in sessions]

@api_router.get("/image/{image_id}")
async def get_image(image_id: str):
    session = await db.generation_sessions.find_one({"images.id": image_id})
    if not session:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # Find the specific image
    for image in session["images"]:
        if image["id"] == image_id:
            if image.get("local_path") and os.path.exists(image["local_path"]):
                return FileResponse(
                    image["local_path"],
                    media_type="image/png",
                    filename=f"pixel_image_{image_id}.png"
                )
            else:
                raise HTTPException(status_code=404, detail="Image file not found")
    
    raise HTTPException(status_code=404, detail="Image not found")

@api_router.post("/upload-prompts")
async def upload_prompts(file: UploadFile = File(...)):
    if not file.filename.endswith(('.txt', '.csv')):
        raise HTTPException(status_code=400, detail="Only .txt and .csv files are supported")
    
    content = await file.read()
    text_content = content.decode('utf-8')
    
    # Parse prompts (one per line, ignore empty lines)
    prompts = [line.strip() for line in text_content.split('\n') if line.strip()]
    
    return {"prompts": prompts, "count": len(prompts)}

@api_router.post("/test-cookie")
async def test_cookie(cookie_data: dict):
    auth_cookie = cookie_data.get("cookie", "_U=")
    generator = PixelDalleGenerator(auth_cookie)
    is_valid = await generator.test_cookie()
    return {"valid": is_valid}

# Background task for processing generation
async def process_generation(session_id: str, prompt: str, styles: List[str], images_per_style: int, auth_cookie: str):
    try:
        # Update session status
        await db.generation_sessions.update_one(
            {"id": session_id},
            {"$set": {"status": "processing", "updated_at": datetime.utcnow()}}
        )
        
        generator = PixelDalleGenerator(auth_cookie)
        
        # Test cookie first
        if not await generator.test_cookie():
            await db.generation_sessions.update_one(
                {"id": session_id},
                {"$set": {"status": "failed", "updated_at": datetime.utcnow()}}
            )
            return
        
        # Generate images
        image_links = await generator.generate_images(prompt, styles, images_per_style)
        
        # Download and save images
        saved_images = []
        for link_data in image_links:
            image_id = str(uuid.uuid4())
            timestamp = time.strftime("%Y%m%d_%H%M%S")
            style_part = f"_{link_data['style'].replace(' ', '_')}" if link_data['style'] else ""
            filename = f"pixel_image{style_part}_{timestamp}_{link_data['index']}.png"
            filepath = STORAGE_DIR / filename
            
            # Create image record
            image = GeneratedImage(
                id=image_id,
                prompt=prompt,
                style=link_data['style'],
                image_url=link_data['url'],
                local_path=str(filepath),
                status="pending"
            )
            
            # Download image
            if await generator.download_image(link_data['url'], str(filepath)):
                image.status = "completed"
            else:
                image.status = "failed"
            
            saved_images.append(image.dict())
        
        # Update session with results
        completed_count = sum(1 for img in saved_images if img["status"] == "completed")
        failed_count = sum(1 for img in saved_images if img["status"] == "failed")
        
        await db.generation_sessions.update_one(
            {"id": session_id},
            {
                "$set": {
                    "status": "completed" if failed_count == 0 else "partially_failed",
                    "images": saved_images,
                    "completed_images": completed_count,
                    "failed_images": failed_count,
                    "updated_at": datetime.utcnow()
                }
            }
        )
        
    except Exception as e:
        logging.error(f"Generation failed for session {session_id}: {str(e)}")
        await db.generation_sessions.update_one(
            {"id": session_id},
            {"$set": {"status": "failed", "updated_at": datetime.utcnow()}}
        )

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
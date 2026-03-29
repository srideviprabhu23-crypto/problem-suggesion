/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { 
  Camera, 
  Upload, 
  RefreshCw, 
  AlertCircle, 
  MapPin, 
  Wrench, 
  ExternalLink,
  ChevronRight,
  Info,
  Scan,
  Languages as LanguagesIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { cn } from './lib/utils';

// --- Constants ---
const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ta', name: 'Tamil (தமிழ்)' },
  { code: 'hi', name: 'Hindi (हिन्दी)' },
  { code: 'te', name: 'Telugu (తెలుగు)' },
  { code: 'kn', name: 'Kannada (ಕನ್ನಡ)' },
  { code: 'ml', name: 'Malayalam (മലയാളம்)' },
  { code: 'bn', name: 'Bengali (বাংলা)' },
  { code: 'mr', name: 'Marathi (मराठी)' },
  { code: 'gu', name: 'Gujarati (ગુજરાતી)' },
];

// --- Types ---
interface AnalysisResult {
  problem: string;
  causes: string[];
  solutions: string[];
  estimatedCost: string;
  recommendedAction: string;
  severity: 'Low' | 'Medium' | 'High';
  serviceType: string;
  fullMarkdown: string;
}

interface GroundingChunk {
  maps?: {
    uri: string;
    title: string;
  };
}

export default function App() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [grounding, setGrounding] = useState<GroundingChunk[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState(LANGUAGES[0]);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Initialization ---
  useEffect(() => {
    startCamera();
    getUserLocation();
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' },
        audio: false 
      });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }
    } catch (err) {
      console.error("Camera access error:", err);
      setError("Unable to access camera. Please check permissions.");
    }
  };

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
    }
  };

  const getUserLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude
          });
        },
        (err) => {
          console.warn("Location error:", err);
        }
      );
    }
  };

  // --- Actions ---
  const captureImage = () => {
    if (videoRef.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setCapturedImage(dataUrl);
        analyzeImage(dataUrl);
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const dataUrl = event.target?.result as string;
        setCapturedImage(dataUrl);
        analyzeImage(dataUrl);
      };
      reader.readAsDataURL(file);
    }
  };

  const analyzeImage = async (base64Image: string) => {
    setIsAnalyzing(true);
    setError(null);
    setResult(null);
    setGrounding([]);

    try {
      const apiKey = process.env.GEMINI_API_KEY;
      
      if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.length < 10) {
        setError("API_KEY_MISSING");
        return;
      }

      const ai = new GoogleGenAI({ apiKey });
      const model = "gemini-3-flash-preview";

      const base64Data = base64Image.split(',')[1];
      
      const prompt = `
        Analyze this image of a real-world problem. 
        Detect the problem, possible causes, suggested solutions, estimated cost, and recommended action.
        
        CRITICAL: Identify the specific PARTS or PRODUCTS needed to fix this (e.g., "10uF Capacitor", "Brake Pads", "PVC Pipe 1/2 inch").
        
        IMPORTANT: Provide the entire response in ${selectedLanguage.name}. 
        The user is located in India, possibly in a specific district or city. 
        Ensure the advice is relevant to the local context of India.
        
        Return the analysis in a clear markdown format.
        Include a line for "Severity: [Low/Medium/High]" and "Cost: [Amount]".
        
        Additionally, use Google Maps to find nearby shops that sell these specific parts or provide the required service based on my location if provided.
      `;

      const response = await ai.models.generateContent({
        model,
        contents: {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: "image/jpeg", data: base64Data } }
          ]
        },
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: location || undefined
            }
          }
        }
      });

      if (!response || !response.candidates || response.candidates.length === 0) {
        throw new Error("No analysis received from AI. Please try a clearer photo.");
      }

      const text = response.text || "No detailed description available, but check the map below for help.";
      
      const severityMatch = text.match(/severity:\s*(Low|Medium|High)/i);
      const costMatch = text.match(/cost:\s*([^\n]+)/i);
      const problemMatch = text.match(/#+\s*([^\n]+)/i) || text.match(/problem:\s*([^\n]+)/i);

      setResult({
        problem: problemMatch?.[1] || "Detected Issue",
        causes: [],
        solutions: [],
        estimatedCost: costMatch?.[1] || "Varies",
        recommendedAction: "Follow AI guidance",
        severity: (severityMatch?.[1] as any) || 'Medium',
        serviceType: "Professional Service",
        fullMarkdown: text
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      setGrounding(chunks as GroundingChunk[]);

    } catch (err: any) {
      console.error("AI Analysis error:", err);
      const message = err.message || "An unexpected error occurred during analysis.";
      setError(message.includes("API_KEY_INVALID") 
        ? "Invalid API Key. Please check your Gemini API settings." 
        : message);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const reset = () => {
    setCapturedImage(null);
    setResult(null);
    setGrounding([]);
    setError(null);
    startCamera();
  };

  // --- Render Helpers ---
  const getSeverityColor = (severity: string) => {
    switch (severity.toLowerCase()) {
      case 'low': return 'text-green-400 bg-green-400/10';
      case 'medium': return 'text-yellow-400 bg-yellow-400/10';
      case 'high': return 'text-red-400 bg-red-400/10';
      default: return 'text-blue-400 bg-blue-400/10';
    }
  };

  return (
    <div className="min-h-screen flex flex-col max-w-md mx-auto relative overflow-hidden bg-hardware-bg text-hardware-text font-sans antialiased">
      {/* Header */}
      <header className="p-6 flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-hardware-accent rounded-lg flex items-center justify-center status-glow">
            <Scan className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-xl font-bold tracking-tight">VisionFix AI</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative group">
            <button className="p-2 hover:bg-white/10 rounded-full transition-colors flex items-center gap-1">
              <LanguagesIcon className="w-5 h-5" />
              <span className="text-[10px] font-bold uppercase hidden sm:inline">{selectedLanguage.code}</span>
            </button>
            <div className="absolute right-0 top-full mt-2 w-48 bg-hardware-bg border border-white/10 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
              {LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => setSelectedLanguage(lang)}
                  className={cn(
                    "w-full px-4 py-2 text-left text-xs hover:bg-white/5 transition-colors",
                    selectedLanguage.code === lang.code && "bg-hardware-accent/20 text-hardware-accent"
                  )}
                >
                  {lang.name}
                </button>
              ))}
            </div>
          </div>
          {capturedImage && (
            <button 
              onClick={reset}
              className="p-2 hover:bg-white/10 rounded-full transition-colors"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex flex-col p-4 gap-6 overflow-y-auto pb-24">
        {/* Camera/Preview Section */}
        <section className="relative aspect-[4/3] rounded-3xl overflow-hidden glass-panel">
          {!capturedImage ? (
            <>
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 border-2 border-white/20 rounded-3xl pointer-events-none" />
              <div className="absolute top-4 right-4 flex gap-2">
                <label className="p-3 bg-black/50 backdrop-blur-md rounded-full cursor-pointer hover:bg-black/70 transition-all">
                  <Upload className="w-5 h-5" />
                  <input type="file" accept="image/*" className="hidden" onChange={handleFileUpload} />
                </label>
              </div>
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2">
                <button 
                  onClick={captureImage}
                  className="w-16 h-16 bg-white rounded-full flex items-center justify-center active:scale-95 transition-transform shadow-xl"
                >
                  <div className="w-14 h-14 border-2 border-hardware-bg rounded-full" />
                </button>
              </div>
            </>
          ) : (
            <img src={capturedImage} alt="Captured" className="w-full h-full object-cover" />
          )}
          
          {isAnalyzing && (
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
              <motion.div 
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                className="w-12 h-12 border-4 border-hardware-accent border-t-transparent rounded-full"
              />
              <p className="text-sm font-medium animate-pulse">Analyzing Problem...</p>
            </div>
          )}
        </section>

        {/* Results Section */}
        <AnimatePresence>
          {error === "API_KEY_MISSING" && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="glass-panel p-8 flex flex-col items-center text-center gap-6 border-hardware-accent/30"
            >
              <div className="w-16 h-16 bg-hardware-accent/20 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-hardware-accent" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-bold">API Key Required</h3>
                <p className="text-sm text-hardware-muted leading-relaxed">
                  To use VisionFix AI, you need to add your Gemini API Key to your deployment environment variables.
                </p>
              </div>
              
              <div className="w-full space-y-3 text-left">
                <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                  <p className="text-[10px] font-mono text-hardware-muted uppercase mb-1">Variable Name</p>
                  <code className="text-xs text-hardware-accent font-mono">GEMINI_API_KEY</code>
                </div>
                <a 
                  href="https://aistudio.google.com/app/apikey" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full py-3 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold transition-all"
                >
                  Get API Key <ExternalLink className="w-4 h-4" />
                </a>
              </div>

              <p className="text-[10px] text-hardware-muted italic">
                After adding the key in Vercel/Cloud Run settings, please redeploy your application.
              </p>
            </motion.div>
          )}

          {error && error !== "API_KEY_MISSING" && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-4 bg-red-400/10 border border-red-400/20 rounded-2xl flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">{error}</p>
            </motion.div>
          )}

          {result && (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-6"
            >
              {/* Main Analysis Card */}
              <div className="glass-panel p-6 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <span className={cn("px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider", getSeverityColor(result.severity))}>
                    {result.severity} Severity
                  </span>
                  <div className="flex items-center gap-1 text-hardware-muted">
                    <Info className="w-4 h-4" />
                    <span className="text-[10px] font-medium uppercase tracking-wider">AI Analysis</span>
                  </div>
                </div>

                <div className="space-y-1">
                  <h2 className="text-2xl font-bold leading-tight">{result.problem}</h2>
                  <p className="text-hardware-accent font-mono text-sm">Est. Cost: {result.estimatedCost}</p>
                </div>

                <div className="h-px bg-white/10" />

                <div className="prose prose-invert prose-sm max-w-none">
                  <div className="text-hardware-muted leading-relaxed">
                    <ReactMarkdown>
                      {result.fullMarkdown}
                    </ReactMarkdown>
                  </div>
                </div>
              </div>

              {/* Nearby Shops Section */}
              {grounding.length > 0 && (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 px-2">
                    <MapPin className="w-5 h-5 text-hardware-accent" />
                    <h3 className="font-bold">Where to Buy & Fix</h3>
                  </div>
                  
                  <div className="flex flex-col gap-3">
                    {grounding.map((chunk, idx) => chunk.maps && (
                      <motion.a
                        key={idx}
                        href={chunk.maps.uri}
                        target="_blank"
                        rel="noopener noreferrer"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: idx * 0.1 }}
                        className="glass-panel p-4 flex items-center justify-between hover:bg-white/10 transition-all group"
                      >
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-sm">{chunk.maps.title}</span>
                          <span className="text-[10px] text-hardware-muted uppercase tracking-widest">View on Maps</span>
                        </div>
                        <ExternalLink className="w-4 h-4 text-hardware-muted group-hover:text-white transition-colors" />
                      </motion.a>
                    ))}
                  </div>
                </div>
              )}

              {/* Action Button */}
              <button 
                onClick={reset}
                className="w-full py-4 bg-white text-hardware-bg font-bold rounded-2xl flex items-center justify-center gap-2 hover:bg-gray-200 transition-colors"
              >
                Scan Another Problem
                <ChevronRight className="w-5 h-5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State / Prompt */}
        {!capturedImage && !isAnalyzing && (
          <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 opacity-50">
            <Camera className="w-12 h-12" />
            <div className="space-y-1">
              <p className="font-medium">Point at a problem</p>
              <p className="text-xs">Broken items, car issues, or error screens</p>
            </div>
          </div>
        )}
      </main>

      {/* Footer / Status Bar */}
      <footer className="p-4 border-t border-white/5 bg-hardware-bg/80 backdrop-blur-lg fixed bottom-0 left-0 right-0 max-w-md mx-auto z-20">
        <div className="flex items-center justify-between text-[10px] font-mono text-hardware-muted uppercase tracking-widest">
          <div className="flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full", stream ? "bg-green-400 animate-pulse" : "bg-red-400")} />
            {stream ? "Sensor Active" : "Sensor Offline"}
          </div>
          <div>VisionFix v1.0.4</div>
        </div>
      </footer>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}

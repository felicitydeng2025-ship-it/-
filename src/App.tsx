/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Play, 
  Pause, 
  RotateCcw, 
  Mic, 
  Square, 
  SkipBack, 
  SkipForward, 
  Trash2, 
  History,
  CheckCircle2,
  AlertCircle,
  Settings,
  Volume2,
  ChevronRight,
  ChevronLeft,
  BookOpen,
  Plus,
  Info,
  Tag,
  Gauge
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { cn, formatTime } from './lib/utils';
import { Sentence, Material } from './types';
import { saveMaterial, getAllMaterials, deleteMaterial } from './lib/db';

// Removed top-level initialization to prevent crash if API key is missing
// const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default function App() {
  const [material, setMaterial] = useState<Material | null>(null);
  const [history, setHistory] = useState<Material[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [loadingMessage, setLoadingMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pastedText, setPastedText] = useState('');
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>('upload');
  const [selectedAudioFile, setSelectedAudioFile] = useState<File | null>(null);
  
  const [currentSentenceIndex, setCurrentSentenceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isAutoAdvance, setIsAutoAdvance] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartTime, setRecordingStartTime] = useState(0);
  const [recordings, setRecordings] = useState<Record<string, string>>({});

  const audioRef = useRef<HTMLAudioElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate, currentSentenceIndex, isPlaying, material]);

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    const currentUrl = material?.audioUrl;
    return () => {
      if (currentUrl && currentUrl.startsWith('blob:')) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [material]);

  const loadHistory = async () => {
    const data = await getAllMaterials();
    setHistory(data.sort((a, b) => b.createdAt - a.createdAt));
  };

  const processContent = async (title: string, text?: string, audioFile?: File) => {
    setIsUploading(true);
    setUploadProgress(10);
    setLoadingMessage('正在准备内容...');
    setError(null);

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === '') {
      setError('未检测到 Gemini API Key。请在 Vercel 项目设置中添加环境变量 GEMINI_API_KEY 或 VITE_GEMINI_API_KEY，并确保其值正确。');
      setIsUploading(false);
      return;
    }
    const ai = new GoogleGenAI({ apiKey });

    let progressInterval: any;
    const startNudging = (start: number, end: number, duration: number) => {
      if (progressInterval) clearInterval(progressInterval);
      let current = start;
      const step = (end - start) / (duration / 100);
      progressInterval = setInterval(() => {
        current += step;
        if (current >= end) {
          clearInterval(progressInterval);
        } else {
          setUploadProgress(Math.floor(current));
        }
      }, 100);
    };

    try {
      let audioUrl = '';
      const isVideo = audioFile?.type.startsWith('video/') || 
                      ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.webm'].some(ext => audioFile?.name.toLowerCase().endsWith(ext));
      
      // Check file size (limit to 20MB to prevent browser crash and API errors)
      if (audioFile && audioFile.size > 20 * 1024 * 1024) {
        setError('文件过大。为了确保处理稳定，请上传 20MB 以内的音视频文件。');
        setIsUploading(false);
        return;
      }

      const getMimeType = (file: File, isVideo: boolean) => {
        if (file.type && file.type !== '') return file.type;
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (isVideo) {
          switch (ext) {
            case 'mp4': return 'video/mp4';
            case 'mov': return 'video/quicktime';
            case 'avi': return 'video/x-msvideo';
            case 'wmv': return 'video/x-ms-wmv';
            case 'flv': return 'video/x-flv';
            case 'webm': return 'video/webm';
            case 'mkv': return 'video/x-matroska';
            default: return 'video/mp4';
          }
        } else {
          switch (ext) {
            case 'mp3': return 'audio/mpeg';
            case 'wav': return 'audio/wav';
            case 'ogg': return 'audio/ogg';
            case 'm4a': return 'audio/mp4';
            default: return 'audio/mpeg';
          }
        }
      };

      const getBase64 = (file: File): Promise<string> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      };

      if (audioFile && text) {
        // Both provided -> Auto Align
        audioUrl = URL.createObjectURL(audioFile);
        setUploadProgress(20);
        setLoadingMessage('正在读取音频文件...');
        const base64Data = await getBase64(audioFile);
        
        setUploadProgress(40);
        setLoadingMessage('正在分析媒体内容并对齐文本（这可能需要一分钟）...');
        startNudging(40, 85, 45000);
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            { text: `请分析这段${isVideo ? '视频' : '音频'}，并将其对齐到以下文本。将文本拆分为逐句列表。
            对于每一句，请提供：
            1. 在${isVideo ? '视频' : '音频'}中的开始时间（startTime）和结束时间（endTime），单位为秒（保留一位小数）。请确保时间范围完整覆盖该句子的发音，但必须在下一句开始前停止。如果两句之间有停顿，请将结束时间定在停顿的中间，确保不包含下一句的任何声音。
            2. 句子解析（analysis）：简要分析句子的语法结构或表达重点（请提供中英文对照，例如：[中文解析] / [English Analysis]）。
            3. 关键词解释（keywords）：列出句中的重点词汇及其含义。
            
            文本内容：
            ${text}
            返回格式：[{"text": "句子1", "startTime": 0.0, "endTime": 2.5, "analysis": "...", "keywords": [{"word": "...", "explanation": "..."}]}, ...]` },
            { inlineData: { data: base64Data, mimeType: getMimeType(audioFile, isVideo) } }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER },
                  analysis: { type: Type.STRING },
                  keywords: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        word: { type: Type.STRING },
                        explanation: { type: Type.STRING }
                      },
                      required: ["word", "explanation"]
                    }
                  }
                },
                required: ["text", "startTime", "endTime", "analysis", "keywords"]
              }
            }
          }
        });
        const results = JSON.parse(response.text);
        
        setUploadProgress(90);
        setLoadingMessage('正在完成素材处理...');
        const newMaterial: Material = {
          id: crypto.randomUUID(),
          title,
          audioUrl,
          mediaType: isVideo ? 'video' : 'audio',
          sentences: results.map((r: any) => ({
            id: crypto.randomUUID(),
            text: r.text,
            startTime: r.startTime,
            endTime: r.endTime,
            analysis: r.analysis,
            keywords: r.keywords,
          })),
          createdAt: Date.now(),
        };
        setMaterial(newMaterial);
        await saveMaterial(newMaterial);
        loadHistory();
        setUploadProgress(100);
        return;
      } else if (audioFile) {
        // Audio only -> ASR with Timestamps
        audioUrl = URL.createObjectURL(audioFile);
        setUploadProgress(20);
        setLoadingMessage('正在读取音频文件...');
        const base64Data = await getBase64(audioFile);
        
        setUploadProgress(50);
        setLoadingMessage('正在转录内容并分析句子（这可能需要一分钟）...');
        startNudging(50, 85, 45000);
        const response = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            { text: `请听这段${isVideo ? '视频' : '音频'}并将其转录为逐句列表。
            对于每一句，请提供：
            1. 在${isVideo ? '视频' : '音频'}中的开始时间（startTime）和结束时间（endTime），单位为秒（保留一位小数）。
               重要准则：
               - startTime 必须严格包含该句第一个单词的最开头声音，宁可稍微提前 0.1s 也不要延后。
               - endTime 必须完整包含该句最后一个单词的尾音，宁可稍微延后 0.2s 也不要提前切断。
               - 确保时间范围完整覆盖该句子的所有发音。
            2. 句子解析（analysis）：简要分析句子的语法结构或表达重点（请提供中英文对照，例如：[中文解析] / [English Analysis]）。
            3. 关键词解释（keywords）：列出句中的重点词汇及其含义。
            
            返回格式：[{"text": "句子1", "startTime": 0.0, "endTime": 2.5, "analysis": "...", "keywords": [{"word": "...", "explanation": "..."}]}, ...]` },
            { inlineData: { data: base64Data, mimeType: getMimeType(audioFile, isVideo) } }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER },
                  analysis: { type: Type.STRING },
                  keywords: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        word: { type: Type.STRING },
                        explanation: { type: Type.STRING }
                      },
                      required: ["word", "explanation"]
                    }
                  }
                },
                required: ["text", "startTime", "endTime", "analysis", "keywords"]
              }
            }
          }
        });
        const results = JSON.parse(response.text);
        
        setUploadProgress(90);
        setLoadingMessage('正在完成素材处理...');
        const newMaterial: Material = {
          id: crypto.randomUUID(),
          title,
          audioUrl,
          mediaType: isVideo ? 'video' : 'audio',
          sentences: results.map((r: any) => ({
            id: crypto.randomUUID(),
            text: r.text,
            startTime: r.startTime,
            endTime: r.endTime,
            analysis: r.analysis,
            keywords: r.keywords,
          })),
          createdAt: Date.now(),
        };
        setMaterial(newMaterial);
        await saveMaterial(newMaterial);
        loadHistory();
        setUploadProgress(100);
        return;
      } else if (text) {
        // Text only -> TTS
        setUploadProgress(30);
        setLoadingMessage('正在分析文本结构...');
        const splitResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: `请将以下文本拆分为逐句列表。
          对于每一句，请提供：
          1. 句子解析（analysis）：简要分析句子的语法结构或表达重点（请提供中英文对照，例如：[中文解析] / [English Analysis]）。
          2. 关键词解释（keywords）：列出句中的重点词汇及其含义。
          
          文本内容：
          ${text}
          返回格式：[{"text": "句子1", "analysis": "...", "keywords": [{"word": "...", "explanation": "..."}]}, ...]`,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  analysis: { type: Type.STRING },
                  keywords: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        word: { type: Type.STRING },
                        explanation: { type: Type.STRING }
                      },
                      required: ["word", "explanation"]
                    }
                  }
                },
                required: ["text", "analysis", "keywords"]
              }
            }
          }
        });
        const results = JSON.parse(splitResponse.text);
        const analysisMap = results.reduce((acc: any, r: any) => {
          acc[r.text] = { analysis: r.analysis, keywords: r.keywords };
          return acc;
        }, {});
        
        setUploadProgress(60);
        setLoadingMessage('正在生成高质量语音...');
        const ttsResponse = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `Please read the following text clearly and completely, ensuring every word is pronounced fully: ${text.slice(0, 5000)}` }] }],
          config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Kore' },
              },
            },
          },
        });
        
        const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
        if (base64Audio) {
          const res = await fetch(`data:audio/mpeg;base64,${base64Audio}`);
          const blob = await res.blob();
          audioUrl = URL.createObjectURL(blob);
        } else {
          throw new Error('无法生成语音');
        }

        setUploadProgress(80);
        setLoadingMessage('正在将语音与文本对齐...');
        startNudging(80, 95, 20000);
        const alignResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview",
          contents: [
            { text: `请分析这段音频，并将其对齐到以下文本。将文本拆分为逐句列表，并为每一句提供在音频中的开始时间（startTime）和结束时间（endTime），单位为秒（保留一位小数）。
            
            重要准则：
            1. 每一句的 startTime 必须严格包含该句第一个单词的最开头声音，宁可稍微提前 0.1s 也不要延后。
            2. 每一句的 endTime 必须完整包含该句最后一个单词的尾音，宁可稍微延后 0.2s 也不要提前切断。
            3. 确保时间范围完整覆盖该句子的所有发音。
            
            文本内容：
            ${text}
            返回格式：[{"text": "句子1", "startTime": 0.0, "endTime": 2.5}, ...]` },
            { inlineData: { data: base64Audio, mimeType: 'audio/mpeg' } }
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  text: { type: Type.STRING },
                  startTime: { type: Type.NUMBER },
                  endTime: { type: Type.NUMBER }
                },
                required: ["text", "startTime", "endTime"]
              }
            }
          }
        });
        const alignResults = JSON.parse(alignResponse.text);
        setUploadProgress(95);
        setLoadingMessage('正在完成素材处理...');
        const newMaterial: Material = {
          id: crypto.randomUUID(),
          title,
          audioUrl,
          sentences: alignResults.map((r: any) => ({
            id: crypto.randomUUID(),
            text: r.text,
            startTime: r.startTime,
            endTime: r.endTime,
            analysis: analysisMap[r.text]?.analysis || "",
            keywords: analysisMap[r.text]?.keywords || [],
          })),
          createdAt: Date.now(),
        };
        setMaterial(newMaterial);
        await saveMaterial(newMaterial);
        loadHistory();
        setUploadProgress(100);
        return;
      } else {
        throw new Error('缺少音频或文本内容');
      }
    } catch (err: any) {
      console.error('Processing error:', err);
      const msg = err.message || '';
      if (msg.includes('API_KEY_INVALID')) {
        setError('API Key 无效，请检查 Vercel 环境变量配置。');
      } else if (msg.includes('User location is not supported')) {
        setError('当前地区（Vercel 部署区域）不支持 Gemini API，请尝试在 Vercel 设置中更改 Function Region 为 US 或其他支持区域。');
      } else if (msg.includes('quota')) {
        setError('API 配额已耗尽，请稍后再试或更换 API Key。');
      } else {
        setError(`处理内容时出错: ${msg || '未知错误'}`);
      }
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setTimeout(() => setIsUploading(false), 500);
    }
  };

  const handlePasteSubmit = () => {
    if (!pastedText.trim()) {
      setError('请输入或粘贴文字内容');
      return;
    }
    processContent('粘贴的素材 ' + new Date().toLocaleTimeString(), pastedText, selectedAudioFile || undefined);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let audioFile: File | null = null;
    let textFile: File | null = null;

    const textExtensions = ['.txt', '.doc', '.docx', '.wps'];
    const videoExtensions = ['.mp4', '.mov', '.avi', '.wmv', '.flv', '.mkv', '.webm'];
    const textMimeTypes = [
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-word.document.macroEnabled.12',
      'application/kswps',
      'application/wps-office.wps'
    ];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      
      if (file.type.startsWith('audio/') || file.type.startsWith('video/') || videoExtensions.includes(extension)) {
        audioFile = file;
      } else if (textMimeTypes.includes(file.type) || textExtensions.includes(extension)) {
        textFile = file;
      }
    }

    if (!audioFile && !textFile) {
      setError('请上传音频/视频文件或文档文件 (.txt, .doc, .docx, .wps)');
      return;
    }

    try {
      let title = '';
      let text = '';

      const getBase64 = (file: File): Promise<string> => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.readAsDataURL(file);
        });
      };

      if (textFile) {
        title = textFile.name.split('.')[0];
        if (textFile.type === 'text/plain' || textFile.name.endsWith('.txt')) {
          text = await textFile.text();
        } else {
          setIsUploading(true);
          setUploadProgress(10);
          const apiKey = process.env.GEMINI_API_KEY;
          if (!apiKey || apiKey === '') {
            setError('未检测到 Gemini API Key。请在 Vercel 环境变量中设置 GEMINI_API_KEY。');
            setIsUploading(false);
            return;
          }
          const ai = new GoogleGenAI({ apiKey });
          const docBase64 = await getBase64(textFile);
          const extractResponse = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: [
              { text: "请提取此文档中的所有文本内容。" },
              { inlineData: { data: docBase64, mimeType: textFile.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } }
            ]
          });
          text = extractResponse.text;
        }
      } else if (audioFile) {
        title = audioFile.name.split('.')[0];
      }

      await processContent(title, text || undefined, audioFile || undefined);
    } catch (err) {
      console.error(err);
      setError('处理文件时出错。');
      setIsUploading(false);
    }
  };

  const playSentence = (index: number) => {
    if (!audioRef.current || !material) return;
    const sentence = material.sentences[index];
    setCurrentSentenceIndex(index);
    // Start 0.1s earlier to ensure the beginning of the word is not cut off
    audioRef.current.currentTime = Math.max(0, sentence.startTime - 0.1);
    audioRef.current.play();
    setIsPlaying(true);
  };

  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleTimeUpdate = () => {
    if (!audioRef.current || !material) return;
    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    const sentence = material.sentences[currentSentenceIndex];
    // Add a small 0.1s grace period to ensure the tail end of the sentence is not cut off
    if (sentence.endTime > 0 && time >= sentence.endTime + 0.1) {
      if (isLooping) {
        audioRef.current.currentTime = sentence.startTime;
      } else if (isAutoAdvance) {
        if (currentSentenceIndex < material.sentences.length - 1) {
          playSentence(currentSentenceIndex + 1);
        } else {
          audioRef.current.pause();
          setIsPlaying(false);
        }
      } else {
        // Default: Stop at the end of the sentence as requested
        audioRef.current.pause();
        setIsPlaying(false);
      }
    }
  };

  const startRecording = async (sentenceId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordings(prev => ({ ...prev, [sentenceId]: url }));
        stream.getTracks().forEach(track => track.stop());
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingStartTime(Date.now());
    } catch (err) {
      setError('无法访问麦克风，请检查权限。');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    const newTime = percentage * duration;
    audioRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const markSentenceBoundary = () => {
    if (!audioRef.current || !material) return;
    const time = audioRef.current.currentTime;
    
    const updatedSentences = [...material.sentences];
    // Set end time for current sentence
    updatedSentences[currentSentenceIndex].endTime = time;
    
    // Set start time for next sentence
    if (currentSentenceIndex < updatedSentences.length - 1) {
      updatedSentences[currentSentenceIndex + 1].startTime = time;
      setCurrentSentenceIndex(currentSentenceIndex + 1);
    }

    const updatedMaterial = { ...material, sentences: updatedSentences };
    setMaterial(updatedMaterial);
    saveMaterial(updatedMaterial);
  };

  const resetSentences = () => {
    if (!material) return;
    const updatedSentences = material.sentences.map(s => ({ ...s, startTime: 0, endTime: 0 }));
    const updatedMaterial = { ...material, sentences: updatedSentences };
    setMaterial(updatedMaterial);
    setCurrentSentenceIndex(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 font-sans selection:bg-indigo-100">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => setMaterial(null)}>
            <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <BookOpen className="text-white w-6 h-6" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">ShadowTalk</h1>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setMaterial(null)}
              className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500"
              title="历史记录"
            >
              <History className="w-5 h-5" />
            </button>
            <button className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500">
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          {!material ? (
            <motion.div 
              key="home"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-12"
            >
              {/* Hero Section */}
              <div className="text-center space-y-4 max-w-2xl mx-auto py-12">
                <h2 className="text-4xl font-extrabold text-slate-900 sm:text-5xl tracking-tight">
                  让每一句跟读都 <span className="text-indigo-600">精准高效</span>
                </h2>
                <p className="text-lg text-slate-600">
                  上传你的学习素材，系统将自动分句。通过逐句精听与录音对比，快速提升你的口语与听力水平。
                </p>
              </div>

              {/* Upload/Paste Tabs */}
              <div className="max-w-xl mx-auto space-y-6">
                <div className="flex p-1 bg-slate-100 rounded-2xl">
                  <button 
                    onClick={() => setActiveTab('upload')}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all",
                      activeTab === 'upload' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    文件上传
                  </button>
                  <button 
                    onClick={() => setActiveTab('paste')}
                    className={cn(
                      "flex-1 py-2.5 rounded-xl text-sm font-bold transition-all",
                      activeTab === 'paste' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                    )}
                  >
                    直接粘贴文字
                  </button>
                </div>

                {activeTab === 'upload' ? (
                  <div className="space-y-4">
                    <label className="group relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed border-slate-300 rounded-3xl bg-white hover:bg-slate-50 hover:border-indigo-400 transition-all cursor-pointer shadow-sm overflow-hidden">
                      <div className="flex flex-col items-center justify-center pt-5 pb-6 space-y-3">
                        <div className="w-16 h-16 bg-indigo-50 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                          <Upload className="w-8 h-8 text-indigo-600" />
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-semibold text-slate-700">点击或拖拽上传素材</p>
                          <p className="text-xs text-slate-500 mt-1">支持 音频/视频 或 文档 (Word/WPS/TXT)</p>
                          <p className="text-[10px] text-slate-400 mt-1">建议文件小于 20MB 以获得最佳体验</p>
                        </div>
                      </div>
                      <input 
                        type="file" 
                        className="hidden" 
                        multiple 
                        accept="audio/*,video/*,.txt,.doc,.docx,.wps" 
                        onChange={handleFileUpload}
                      />
                      {isUploading && (
                        <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center p-8">
                          <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
                            <motion.div 
                              className="bg-indigo-600 h-2 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${uploadProgress}%` }}
                            />
                          </div>
                          <p className="text-sm font-medium text-indigo-600 animate-pulse">
                            {loadingMessage} {uploadProgress}%
                          </p>
                          <p className="text-[10px] text-slate-400 mt-2 text-center">
                            音频分析是一项复杂的任务，根据文件大小，可能需要长达 60 秒的时间。
                          </p>
                        </div>
                      )}
                    </label>

                    <div className="flex items-center gap-4">
                      <div className="h-px bg-slate-200 flex-1" />
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">或者</span>
                      <div className="h-px bg-slate-200 flex-1" />
                    </div>

                    <button 
                      onClick={() => setActiveTab('paste')}
                      className="w-full py-4 px-6 bg-white border border-slate-200 rounded-2xl text-slate-600 font-bold hover:bg-slate-50 transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <Plus className="w-5 h-5" />
                      直接粘贴文字内容
                    </button>
                  </div>
                ) : (
                  <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm space-y-6 relative overflow-hidden">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <label className="text-sm font-bold text-slate-700">文字内容</label>
                        <button 
                          onClick={() => setActiveTab('upload')}
                          className="text-xs font-bold text-indigo-600 hover:underline"
                        >
                          切换到文件上传
                        </button>
                      </div>
                      <textarea 
                        value={pastedText}
                        onChange={(e) => setPastedText(e.target.value)}
                        placeholder="在此粘贴你想跟读的文字内容..."
                        className="w-full h-48 p-4 bg-slate-50 rounded-2xl border-none focus:ring-2 focus:ring-indigo-500 resize-none text-slate-700 placeholder:text-slate-400"
                      />
                    </div>

                    <div className="space-y-4">
                      <label className="text-sm font-bold text-slate-700">配音音频 (可选)</label>
                      <div className="flex items-center gap-4">
                        <label className="flex-1 flex items-center gap-3 p-4 bg-slate-50 rounded-2xl border border-slate-200 cursor-pointer hover:bg-slate-100 transition-all">
                          <Upload className="w-5 h-5 text-slate-400" />
                          <span className="text-sm text-slate-500 truncate">
                            {selectedAudioFile ? selectedAudioFile.name : "上传音频文件 (不上传则自动生成语音)"}
                          </span>
                          <input 
                            type="file" 
                            className="hidden" 
                            accept="audio/*" 
                            onChange={(e) => setSelectedAudioFile(e.target.files?.[0] || null)}
                          />
                        </label>
                        {selectedAudioFile && (
                          <button 
                            onClick={() => setSelectedAudioFile(null)}
                            className="p-4 text-slate-400 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-5 h-5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <button 
                      onClick={handlePasteSubmit}
                      disabled={isUploading || !pastedText.trim()}
                      className="w-full bg-indigo-600 text-white py-4 rounded-2xl font-bold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-indigo-100"
                    >
                      开始处理
                    </button>
                    {isUploading && (
                      <div className="absolute inset-0 bg-white/90 flex flex-col items-center justify-center p-8">
                        <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
                          <motion.div 
                            className="bg-indigo-600 h-2 rounded-full"
                            initial={{ width: 0 }}
                            animate={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-sm font-medium text-indigo-600 animate-pulse">
                          正在处理素材... {uploadProgress}%
                        </p>
                      </div>
                    )}
                  </div>
                )}
                
                {error && (
                  <div className="mt-4 p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-600 text-sm">
                    <AlertCircle className="w-5 h-5 shrink-0" />
                    {error}
                  </div>
                )}
              </div>

              {/* History Section */}
              {history.length > 0 && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold text-slate-800">最近学习</h3>
                    <button className="text-sm font-medium text-indigo-600 hover:text-indigo-700">查看全部</button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {history.map((item) => (
                      <motion.div 
                        key={item.id}
                        whileHover={{ y: -4 }}
                        className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group"
                        onClick={() => setMaterial(item)}
                      >
                        <div className="flex justify-between items-start mb-4">
                          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                            <Play className="w-5 h-5 text-slate-400 group-hover:text-indigo-600" />
                          </div>
                          <button 
                            onClick={(e) => {
                              e.stopPropagation();
                              deleteMaterial(item.id).then(loadHistory);
                            }}
                            className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <h4 className="font-bold text-slate-800 line-clamp-1 mb-1">{item.title}</h4>
                        <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleDateString()} · {item.sentences.length} 句</p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <motion.div 
              key="player"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="grid grid-cols-1 lg:grid-cols-12 gap-8"
            >
              {/* Left: Sentence List */}
              <div className="lg:col-span-8 space-y-6">
                <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                    <h3 className="font-bold text-slate-800 flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-indigo-600" />
                      逐句跟读
                    </h3>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-2 py-1 bg-indigo-100 text-indigo-700 rounded-md">
                        {currentSentenceIndex + 1} / {material.sentences.length}
                      </span>
                    </div>
                  </div>
                  
                    <div className="max-h-[60vh] overflow-y-auto p-4 space-y-4 scrollbar-thin scrollbar-thumb-slate-200">
                      {material.sentences.map((sentence, index) => {
                        const isActive = currentSentenceIndex === index;
                        const isCurrentlyPlaying = isActive && isPlaying;
                        
                        return (
                          <div 
                            key={sentence.id}
                            className={cn(
                              "p-5 rounded-2xl border transition-all group relative",
                              isActive 
                                ? (isCurrentlyPlaying 
                                    ? "bg-indigo-100 border-indigo-400 shadow-md ring-2 ring-indigo-200" 
                                    : "bg-indigo-50 border-indigo-200 shadow-sm")
                                : "bg-white border-slate-100 hover:border-slate-200"
                            )}
                            onClick={() => playSentence(index)}
                          >
                            <div className="flex gap-4">
                              <div className="flex flex-col items-center gap-2 pt-1">
                                <span className={cn(
                                  "text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full transition-all",
                                  isActive ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-400"
                                )}>
                                  {isCurrentlyPlaying ? (
                                    <motion.div
                                      animate={{ scale: [0.8, 1.1, 0.8] }}
                                      transition={{ repeat: Infinity, duration: 1.5 }}
                                    >
                                      <Volume2 className="w-3.5 h-3.5" />
                                    </motion.div>
                                  ) : (
                                    index + 1
                                  )}
                                </span>
                              </div>
                              <div className="flex-1 space-y-3">
                                <p className={cn(
                                  "text-lg leading-relaxed transition-colors",
                                  isActive 
                                    ? (isCurrentlyPlaying ? "text-indigo-900 font-bold" : "text-slate-900 font-medium") 
                                    : "text-slate-600"
                                )}>
                                  {sentence.text}
                                </p>
                                
                                {/* Sentence Controls */}
                                <div className="flex items-center gap-4 pt-2">
                                  <button 
                                    onClick={(e) => { 
                                      e.stopPropagation(); 
                                      if (isCurrentlyPlaying) togglePlay();
                                      else playSentence(index); 
                                    }}
                                    className={cn(
                                      "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors",
                                      isCurrentlyPlaying 
                                        ? "bg-indigo-600 text-white shadow-sm" 
                                        : "text-indigo-600 hover:bg-indigo-100"
                                    )}
                                  >
                                    {isCurrentlyPlaying ? (
                                      <Pause className="w-3.5 h-3.5 fill-current" />
                                    ) : (
                                      <Play className="w-3.5 h-3.5 fill-current" />
                                    )}
                                    {isCurrentlyPlaying ? "正在播放" : "播放原音"}
                                  </button>
                              
                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isRecording) stopRecording();
                                  else startRecording(sentence.id);
                                }}
                                className={cn(
                                  "flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors",
                                  isRecording && currentSentenceIndex === index
                                    ? "bg-red-100 text-red-600 animate-pulse"
                                    : "text-slate-600 hover:bg-slate-100"
                                )}
                              >
                                {isRecording && currentSentenceIndex === index ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                                {recordings[sentence.id] ? "重新录音" : "开始录音"}
                              </button>

                              {recordings[sentence.id] && (
                                <>
                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const audio = new Audio(recordings[sentence.id]);
                                      audio.playbackRate = playbackRate;
                                      audio.play();
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg transition-colors"
                                  >
                                    <Play className="w-3.5 h-3.5 fill-current" />
                                    播放我的录音
                                  </button>

                                  <button 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      // Play original
                                      playSentence(index);
                                      // Play recording
                                      const userAudio = new Audio(recordings[sentence.id]);
                                      userAudio.playbackRate = playbackRate;
                                      userAudio.play();
                                    }}
                                    className="flex items-center gap-1.5 text-xs font-bold text-amber-600 hover:bg-amber-50 px-3 py-1.5 rounded-lg transition-colors"
                                  >
                                    <Volume2 className="w-3.5 h-3.5" />
                                    对比录音
                                  </button>
                                </>
                              )}

                              <button 
                                onClick={(e) => { e.stopPropagation(); playSentence(index); }}
                                className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                再读一遍
                              </button>

                              <button 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const rates = [0.5, 0.8, 1.0, 1.2, 1.5, 2.0];
                                  const nextRate = rates[(rates.indexOf(playbackRate) + 1) % rates.length];
                                  setPlaybackRate(nextRate);
                                  if (audioRef.current) audioRef.current.playbackRate = nextRate;
                                }}
                                className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:bg-slate-100 px-3 py-1.5 rounded-lg transition-colors"
                              >
                                <Gauge className="w-3.5 h-3.5" />
                                {playbackRate}x
                              </button>
                            </div>

                            {/* Sentence Analysis & Keywords */}
                            {(currentSentenceIndex === index || sentence.analysis || (sentence.keywords && sentence.keywords.length > 0)) && (
                              <div className="mt-4 pt-4 border-t border-slate-100 space-y-3">
                                {sentence.analysis ? (
                                  <div className="flex gap-2">
                                    <div className="mt-0.5 p-1 bg-amber-50 rounded-md shrink-0">
                                      <Info className="w-3.5 h-3.5 text-amber-600" />
                                    </div>
                                    <div>
                                      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">句子分析</h5>
                                      <p className="text-sm text-slate-600 leading-relaxed">{sentence.analysis}</p>
                                    </div>
                                  </div>
                                ) : currentSentenceIndex === index && (
                                  <div className="flex gap-2 opacity-50">
                                    <div className="mt-0.5 p-1 bg-slate-50 rounded-md shrink-0">
                                      <Info className="w-3.5 h-3.5 text-slate-400" />
                                    </div>
                                    <div>
                                      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">句子分析</h5>
                                      <p className="text-sm text-slate-400 italic">暂无分析</p>
                                    </div>
                                  </div>
                                )}
                                
                                {sentence.keywords && sentence.keywords.length > 0 ? (
                                  <div className="flex gap-2">
                                    <div className="mt-0.5 p-1 bg-emerald-50 rounded-md shrink-0">
                                      <Tag className="w-3.5 h-3.5 text-emerald-600" />
                                    </div>
                                    <div className="flex-1">
                                      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">关键词</h5>
                                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {sentence.keywords.map((kw, i) => (
                                          <div key={i} className="bg-slate-50/80 rounded-lg p-2 border border-slate-100/50">
                                            <span className="text-xs font-bold text-indigo-600 block mb-0.5">{kw.word}</span>
                                            <span className="text-[11px] text-slate-500 leading-tight">{kw.explanation}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                ) : currentSentenceIndex === index && (
                                  <div className="flex gap-2 opacity-50">
                                    <div className="mt-0.5 p-1 bg-slate-50 rounded-md shrink-0">
                                      <Tag className="w-3.5 h-3.5 text-slate-400" />
                                    </div>
                                    <div>
                                      <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">关键词</h5>
                                      <p className="text-sm text-slate-400 italic">暂无关键词</p>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

                {/* Sync Helper (Only if timestamps are not set) */}
                {material.sentences.every(s => s.endTime === 0) && (
                  <div className="bg-amber-50 border border-amber-100 p-6 rounded-3xl space-y-4">
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-6 h-6 text-amber-600 shrink-0" />
                      <div>
                        <h4 className="font-bold text-amber-900">同步音频与文本</h4>
                        <p className="text-sm text-amber-800 mt-1">
                          当前素材未设置时间戳。您可以播放音频并在每句话结束时点击按钮，或者直接点击上方进度条定位后标记。
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={markSentenceBoundary}
                        className="bg-amber-600 text-white px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-700 transition-colors shadow-sm"
                      >
                        标记当前句结束
                      </button>
                      <button 
                        onClick={resetSentences}
                        className="text-amber-700 px-6 py-2.5 rounded-xl font-bold text-sm hover:bg-amber-100 transition-colors"
                      >
                        重置所有标记
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right: Controls & Info */}
              <div className="lg:col-span-4 space-y-6">
                {/* Main Player Card */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm sticky top-28">
                  <div className="space-y-6">
                    <div className="text-center space-y-2">
                      <h3 className="font-bold text-slate-800 line-clamp-1">{material.title}</h3>
                      <p className="text-xs text-slate-500">正在播放第 {currentSentenceIndex + 1} 句</p>
                    </div>

                    {/* Media Player (Visible if Video) */}
                    {material.mediaType === 'video' && (
                      <div className="aspect-video bg-black rounded-2xl overflow-hidden shadow-inner">
                        <video 
                          ref={audioRef as any}
                          src={material.audioUrl}
                          onTimeUpdate={handleTimeUpdate}
                          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
                          onEnded={() => setIsPlaying(false)}
                          className="w-full h-full object-contain"
                          onClick={togglePlay}
                        />
                      </div>
                    )}

                    {/* Active Sentence Display */}
                    <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                      <p className="text-sm font-medium text-slate-700 leading-relaxed mb-3">
                        {material.sentences[currentSentenceIndex].text}
                      </p>

                      <div className="flex flex-wrap gap-2 mb-3">
                        <button 
                          onClick={() => {
                            if (isRecording) stopRecording();
                            else startRecording(material.sentences[currentSentenceIndex].id);
                          }}
                          className={cn(
                            "flex-1 flex items-center justify-center gap-1.5 text-xs font-bold px-3 py-2 rounded-lg transition-colors shadow-sm",
                            isRecording && currentSentenceIndex === currentSentenceIndex
                              ? "bg-red-100 text-red-600 animate-pulse"
                              : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
                          )}
                        >
                          {isRecording ? <Square className="w-3.5 h-3.5 fill-current" /> : <Mic className="w-3.5 h-3.5" />}
                          {recordings[material.sentences[currentSentenceIndex].id] ? "重新录音" : "开始录音"}
                        </button>

                        {recordings[material.sentences[currentSentenceIndex].id] && (
                          <button 
                            onClick={() => {
                              const audio = new Audio(recordings[material.sentences[currentSentenceIndex].id]);
                              audio.play();
                            }}
                            className="flex-1 flex items-center justify-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-3 py-2 rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors shadow-sm"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            播放我的录音
                          </button>
                        )}
                      </div>
                      
                      <div className="space-y-2 pt-3 border-t border-slate-200/60">
                        <div className="flex gap-2">
                          <Info className="w-3 h-3 text-amber-500 mt-0.5 shrink-0" />
                          <div>
                            <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">句子分析</h5>
                            <p className="text-[11px] text-slate-600 leading-tight">
                              {material.sentences[currentSentenceIndex].analysis || "暂无分析"}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex gap-2">
                          <Tag className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                          <div>
                            <h5 className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">关键词</h5>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {material.sentences[currentSentenceIndex].keywords && material.sentences[currentSentenceIndex].keywords.length > 0 ? (
                                material.sentences[currentSentenceIndex].keywords.map((kw, i) => (
                                  <span key={i} className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-slate-100 text-slate-500">
                                    <span className="font-bold text-indigo-600 mr-1">{kw.word}</span>
                                    {kw.explanation}
                                  </span>
                                ))
                              ) : (
                                <span className="text-[10px] text-slate-400 italic">暂无关键词</span>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="space-y-2">
                      <div 
                        className="relative h-2 bg-slate-100 rounded-full cursor-pointer group/progress overflow-hidden"
                        onClick={handleTimelineClick}
                        onMouseMove={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const x = e.clientX - rect.left;
                          const percentage = (x / rect.width) * 100;
                          e.currentTarget.style.setProperty('--hover-pos', `${percentage}%`);
                        }}
                      >
                        <motion.div 
                          className="absolute top-0 left-0 h-full bg-indigo-600 rounded-full"
                          animate={{ width: `${(currentTime / duration) * 100}%` }}
                        />
                        <div 
                          className="absolute top-0 left-0 h-full w-0.5 bg-indigo-400/50 opacity-0 group-hover/progress:opacity-100 transition-opacity"
                          style={{ left: 'var(--hover-pos, 0%)' }}
                        />
                      </div>
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        <span className="text-indigo-600">{formatTime(currentTime)}</span>
                        <span>{formatTime(duration)}</span>
                      </div>
                    </div>

                    {/* Controls */}
                    <div className="flex items-center justify-center gap-6">
                      <button 
                        onClick={() => {
                          const prev = Math.max(0, currentSentenceIndex - 1);
                          playSentence(prev);
                        }}
                        className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
                      >
                        <SkipBack className="w-6 h-6" />
                      </button>
                      
                      <button 
                        onClick={togglePlay}
                        className="w-16 h-16 bg-indigo-600 rounded-full flex items-center justify-center text-white shadow-xl shadow-indigo-200 hover:scale-105 active:scale-95 transition-all"
                      >
                        {isPlaying ? <Pause className="w-8 h-8 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                      </button>

                      <button 
                        onClick={() => {
                          const next = Math.min(material.sentences.length - 1, currentSentenceIndex + 1);
                          playSentence(next);
                        }}
                        className="p-3 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-full transition-all"
                      >
                        <SkipForward className="w-6 h-6" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                      <button 
                        onClick={() => setIsLooping(!isLooping)}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                          isLooping ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        <RotateCcw className={cn("w-4 h-4", isLooping && "animate-spin-slow")} />
                        单句循环
                      </button>

                      <button 
                        onClick={() => setIsAutoAdvance(!isAutoAdvance)}
                        className={cn(
                          "flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all",
                          isAutoAdvance ? "bg-indigo-600 text-white" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                        )}
                      >
                        <SkipForward className="w-4 h-4" />
                        自动连播
                      </button>

                      <div className="flex items-center gap-3">
                        <Volume2 className="w-4 h-4 text-slate-400" />
                        <input 
                          type="range" 
                          min="0" 
                          max="1" 
                          step="0.1" 
                          value={volume}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            setVolume(v);
                            if (audioRef.current) audioRef.current.volume = v;
                          }}
                          className="w-20 h-1 bg-slate-100 rounded-full appearance-none cursor-pointer accent-indigo-600"
                        />
                      </div>
                    </div>

                    <div className="space-y-3 pt-4 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <Gauge className="w-4 h-4 text-slate-400" />
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">语速调节</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        {[0.5, 0.8, 1, 1.2, 1.5, 2.0].map(rate => (
                          <button 
                            key={rate}
                            onClick={() => {
                              setPlaybackRate(rate);
                              if (audioRef.current) audioRef.current.playbackRate = rate;
                            }}
                            className={cn(
                              "py-2 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center",
                              playbackRate === rate ? "bg-indigo-100 text-indigo-700" : "bg-slate-50 text-slate-500 hover:bg-slate-100"
                            )}
                          >
                            <span>{rate}x</span>
                            <span className="text-[8px] opacity-60 font-normal">
                              {rate < 1 ? "慢速" : rate === 1 ? "正常" : "快速"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tips Card */}
                <div className="bg-indigo-600 p-6 rounded-3xl text-white shadow-lg shadow-indigo-100">
                  <h4 className="font-bold mb-3 flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" />
                    跟读技巧
                  </h4>
                  <ul className="text-xs space-y-3 opacity-90 leading-relaxed">
                    <li>• 先完整听一遍原句，注意重音与连读。</li>
                    <li>• 开启“单句循环”，反复模仿发音细节。</li>
                    <li>• 录音后对比原音，找出语调差异。</li>
                    <li>• 尝试调低倍速（0.8x）进行慢速跟读。</li>
                  </ul>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Hidden Audio Element */}
      {material && material.mediaType !== 'video' && (
        <audio 
          ref={audioRef}
          src={material.audioUrl}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
          onEnded={() => setIsPlaying(false)}
        />
      )}

      {/* Footer */}
      <footer className="mt-auto py-8 border-t border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-6 text-center text-slate-400 text-sm">
          <p>© 2026 ShadowTalk · 你的语言学习好伙伴</p>
        </div>
      </footer>

      <style>{`
        .animate-spin-slow {
          animation: spin 3s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

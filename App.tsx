
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, TranslationResult, ProcessingState, TargetLanguage } from './types';
import { translateAudio, synthesizeSpeech, resolveAudioLink, translateAndSynthesizeText } from './services/geminiService';
import { createWavBlob, decodeAudioData } from './utils/audioUtils';

type InputMode = 'file' | 'url' | 'record';

const I18N = {
  zh: {
    auth_title: "启用您的 AI 专家",
    auth_desc_studio: "欢迎！为了保护您的额度和隐私，请选择您的 Google API 密钥以开始翻译。",
    auth_desc_vercel: "检测到您正在访问独立站点。由于浏览器安全限制，无法直接在此唤起密钥选择器。",
    auth_btn_connect: "尝试连接我的密钥",
    auth_btn_help: "获取我的 API Key",
    guide_title: "连接密钥的正确方式",
    guide_p1_title: "方案 A：使用 AI Studio 预览 (推荐)",
    guide_p1_content: "在 AI Studio 开发界面的右上角点击「Save」保存，然后点击「Test App」。在弹出的新页面中，您可以使用官方顶部的密钥选择器一键连接。",
    guide_p2_title: "方案 B：安装浏览器扩展",
    guide_p2_content: "安装「Google AI Studio Bridge」扩展程序，即可让此 Vercel 站点直接获得唤起密钥选择器的权限。",
    guide_btn_gotit: "返回重试",
    env_standalone: "独立站点模式",
    env_preview: "AI Studio 托管",
    title: "听懂世界，从一键开始。",
    subtitle: "多语种智能译制专家",
    mode_file: "本地上传",
    mode_url: "网页解析",
    mode_record: "实时录音",
    url_placeholder: "粘贴链接，开始翻译...",
    status_understanding: "AI 深度理解内容中...",
    status_synthesizing: "正在合成中文配音...",
    status_completed: "译制成功！",
    status_error: "处理中断",
    result_listening: "收听翻译配音",
    result_playing: "正在播报...",
    result_export: "导出音频",
    result_summary: "内容摘要",
    result_source: "原文转录",
    result_translation: "中文译文",
    initializing: "正在安全连接...",
    auth_switch: "切换密钥"
  },
  en: {
    auth_title: "Enable Your AI Expert",
    auth_desc_studio: "Welcome! To protect your quota and privacy, please select your Google API Key to start.",
    auth_desc_vercel: "Standalone site detected. Browser security prevents opening the key selector directly here.",
    auth_btn_connect: "Try to Connect Key",
    auth_btn_help: "Get My API Key",
    guide_title: "How to Connect?",
    guide_p1_title: "Option A: AI Studio Test App (Recommended)",
    guide_p1_content: "Click 'Save' in your AI Studio project, then click 'Test App'. The native key selector will appear at the top of the new page.",
    guide_p2_title: "Option B: Install Browser Extension",
    guide_p2_content: "Install the 'Google AI Studio Bridge' extension to enable direct key connection on standalone sites.",
    guide_btn_gotit: "Got it",
    env_standalone: "Standalone Mode",
    env_preview: "AI Studio Managed",
    title: "Understand the World.",
    subtitle: "AI Voice Translation Expert",
    mode_file: "Upload",
    mode_url: "URL",
    mode_record: "Record",
    url_placeholder: "Paste link to translate...",
    status_understanding: "AI Analyzing...",
    status_synthesizing: "Synthesizing...",
    status_completed: "Completed!",
    status_error: "Error",
    result_listening: "Listen to Translation",
    result_playing: "Playing...",
    result_export: "Export",
    result_summary: "Key Insights",
    result_source: "Source",
    result_translation: "Translation",
    initializing: "Initializing...",
    auth_switch: "Switch Key"
  }
};

const App: React.FC = () => {
  const [mode, setMode] = useState<InputMode>('file');
  const [targetLang, setTargetLang] = useState<TargetLanguage>('zh');
  const [urlInput, setUrlInput] = useState('');
  const [processing, setProcessing] = useState<ProcessingState>({
    status: AppStatus.IDLE,
    progress: 0,
    message: '' 
  });
  const [result, setResult] = useState<TranslationResult | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isKeyMissing, setIsKeyMissing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBridgeAvailable, setIsBridgeAvailable] = useState(false);
  const [showGuide, setShowGuide] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const t = I18N[targetLang];
  const isIdle = processing.status === AppStatus.IDLE || processing.status === AppStatus.COMPLETED || processing.status === AppStatus.ERROR;

  const checkKeyStatus = async () => {
    const bridge = (window as any).aistudio;
    const hasBridge = !!(bridge && bridge.hasSelectedApiKey && bridge.openSelectKey);
    setIsBridgeAvailable(hasBridge);

    if (hasBridge) {
      try {
        const hasKey = await bridge.hasSelectedApiKey();
        setIsKeyMissing(!hasKey);
      } catch (e) {
        setIsKeyMissing(true);
      }
    } else {
      const envKey = process.env.API_KEY;
      // In standalone Vercel, if env key is missing, we must show the guide
      setIsKeyMissing(!envKey || envKey === 'undefined' || envKey === '');
    }
  };

  useEffect(() => {
    checkKeyStatus().finally(() => setIsInitializing(false));
  }, []);

  const handleConnectKey = async () => {
    if (isBridgeAvailable) {
      try {
        await (window as any).aistudio.openSelectKey();
        setIsKeyMissing(false);
      } catch (e) {
        setShowGuide(true);
      }
    } else {
      setShowGuide(true);
    }
  };

  const processAudioBlob = async (blob: Blob) => {
    setResult(null);
    setProcessing({ status: AppStatus.UPLOADING, progress: 20, message: t.status_understanding });
    try {
      const translation = await translateAudio(blob, targetLang);
      setProcessing({ status: AppStatus.SYNTHESIZING, progress: 70, message: t.status_synthesizing });
      const pcmData = await synthesizeSpeech(translation.translatedText, targetLang);
      const wavBlob = createWavBlob(pcmData, 24000);
      setResult({ ...translation, targetLang, audioBlob: wavBlob, audioUrl: URL.createObjectURL(wavBlob) });
      setProcessing({ status: AppStatus.COMPLETED, progress: 100, message: "" });
    } catch (error: any) {
      if (error.message?.includes("401") || error.message?.toLowerCase().includes("key")) {
        setIsKeyMissing(true);
      }
      setProcessing({ status: AppStatus.ERROR, progress: 0, message: t.status_error, error: error.message });
    }
  };

  const handleUrlSubmit = async () => {
    if (!urlInput) return;
    setResult(null);
    setProcessing({ status: AppStatus.UPLOADING, progress: 10, message: t.status_understanding });
    try {
      const sniff = await resolveAudioLink(urlInput);
      if (sniff.url) {
        const res = await fetch(sniff.url);
        processAudioBlob(await res.blob());
      } else if (sniff.textContent) {
        const textResult = await translateAndSynthesizeText(sniff.textContent, targetLang);
        const wavBlob = createWavBlob(textResult.pcmData, 24000);
        setResult({ ...textResult, targetLang, audioBlob: wavBlob, audioUrl: URL.createObjectURL(wavBlob) });
        setProcessing({ status: AppStatus.COMPLETED, progress: 100, message: "" });
      }
    } catch (err: any) {
      setProcessing({ status: AppStatus.ERROR, progress: 0, message: t.status_error, error: err.message });
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">{t.initializing}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 pt-safe">
      {/* 密钥鉴权页 */}
      {isKeyMissing && (
        <div className="fixed inset-0 z-[200] bg-slate-900 flex items-center justify-center p-6 overflow-y-auto">
          <div className="max-w-md w-full space-y-8 animate-in fade-in zoom-in-95 duration-500 py-10">
            {!showGuide ? (
              <>
                <div className="text-center space-y-6">
                   <div className="w-24 h-24 audio-gradient rounded-[2.5rem] flex items-center justify-center mx-auto shadow-2xl rotate-3">
                     <i className={`fas ${isBridgeAvailable ? 'fa-bolt-lightning' : 'fa-link-slash'} text-white text-4xl`}></i>
                   </div>
                   <div className="space-y-3">
                     <h2 className="text-3xl font-black text-white tracking-tight">{t.auth_title}</h2>
                     <p className="text-slate-400 text-sm leading-relaxed px-6">
                       {isBridgeAvailable ? t.auth_desc_studio : t.auth_desc_vercel}
                     </p>
                   </div>
                </div>

                <div className="bg-slate-800/50 p-8 rounded-[2rem] border border-slate-700/50 shadow-2xl space-y-4">
                   <button onClick={handleConnectKey} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-lg hover:bg-indigo-500 transition-all active:scale-95 uppercase tracking-widest flex items-center justify-center gap-3">
                      <i className="fas fa-plug"></i> {t.auth_btn_connect}
                   </button>
                   <a href="https://aistudio.google.com/app/apikey" target="_blank" className="block text-center py-3 text-[10px] font-black text-slate-500 uppercase tracking-widest hover:text-indigo-400 transition-colors">
                     {t.auth_btn_help} <i className="fas fa-external-link-alt ml-1"></i>
                   </a>
                </div>
                
                <div className="text-center">
                  <span className="px-4 py-1.5 bg-slate-800/80 text-slate-500 rounded-full text-[9px] font-black uppercase tracking-widest border border-slate-700/50">
                    {isBridgeAvailable ? t.env_preview : t.env_standalone}
                  </span>
                </div>
              </>
            ) : (
              <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl space-y-8 text-slate-900 animate-in slide-in-from-bottom-8">
                 <div className="flex justify-between items-start">
                   <h3 className="text-2xl font-black tracking-tight text-indigo-600">{t.guide_title}</h3>
                   <i className="fas fa-circle-question text-slate-200 text-3xl"></i>
                 </div>
                 
                 <div className="space-y-6">
                    <div className="space-y-2">
                      <h4 className="font-black text-xs uppercase tracking-widest text-slate-400">{t.guide_p1_title}</h4>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed">{t.guide_p1_content}</p>
                    </div>

                    <div className="h-px bg-slate-100"></div>

                    <div className="space-y-2">
                      <h4 className="font-black text-xs uppercase tracking-widest text-slate-400">{t.guide_p2_title}</h4>
                      <p className="text-sm font-medium text-slate-600 leading-relaxed">{t.guide_p2_content}</p>
                    </div>
                 </div>

                 <button onClick={() => setShowGuide(false)} className="w-full py-4 bg-slate-900 text-white rounded-2xl font-black hover:bg-slate-800 transition-all active:scale-95 uppercase tracking-widest text-xs">
                    {t.guide_btn_gotit}
                 </button>
              </div>
            )}
          </div>
        </div>
      )}

      <nav className="glass-nav sticky top-0 z-[60] p-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.location.reload()}>
            <div className="w-9 h-9 audio-gradient rounded-xl flex items-center justify-center shadow-lg shadow-indigo-200">
              <i className="fas fa-bolt-lightning text-white text-sm"></i>
            </div>
            <span className="font-extrabold text-lg tracking-tight">LinguaBridge</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleConnectKey} className="h-9 px-3 bg-slate-100 rounded-xl text-slate-500 hover:text-indigo-600 transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
               <i className="fas fa-key"></i> {t.auth_switch}
            </button>
            <div className="flex bg-slate-100 p-1 rounded-xl">
               <button onClick={() => setTargetLang('zh')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${targetLang === 'zh' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>ZH</button>
               <button onClick={() => setTargetLang('en')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${targetLang === 'en' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>EN</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 mt-12 sm:mt-20 space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 text-indigo-500 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">
             <i className="fas fa-sparkles"></i> {t.subtitle}
          </div>
          <h1 className="text-4xl sm:text-6xl font-black tracking-tighter leading-tight px-4">{t.title}</h1>
        </div>

        <div className="bg-white rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
          <div className="flex bg-slate-50/50 p-1.5 gap-1.5 border-b border-slate-100">
            {(['file', 'url', 'record'] as const).map((m) => (
              <button key={m} onClick={() => setMode(m)} className={`flex-1 py-3.5 rounded-2xl font-black text-[10px] uppercase tracking-widest transition-all ${mode === m ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}>
                {m === 'file' ? t.mode_file : m === 'url' ? t.mode_url : t.mode_record}
              </button>
            ))}
          </div>

          <div className="p-8 sm:p-12">
            {mode === 'url' && (
              <div className="relative group">
                <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder={t.url_placeholder} className="w-full pl-6 pr-32 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all text-sm font-bold shadow-inner" />
                <button onClick={handleUrlSubmit} className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-slate-900 transition-all shadow-md">GO</button>
              </div>
            )}

            {mode === 'file' && (
              <div onClick={() => isIdle && fileInputRef.current?.click()} className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all ${isIdle ? 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer' : 'opacity-50'}`}>
                <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processAudioBlob(e.target.files[0])} className="hidden" accept="audio/*" />
                <i className="fas fa-cloud-arrow-up text-4xl text-indigo-200 mb-4 block"></i>
                <h3 className="text-lg font-black text-slate-800">{t.mode_file}</h3>
                <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supports MP3, WAV, M4A</p>
              </div>
            )}

            {mode === 'record' && (
              <div className="flex flex-col items-center justify-center py-10 rounded-3xl bg-slate-50">
                <button onClick={isRecording ? () => { mediaRecorderRef.current?.stop(); setIsRecording(false); } : async () => {
                  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                  mediaRecorderRef.current = new MediaRecorder(stream);
                  chunksRef.current = [];
                  mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
                  mediaRecorderRef.current.onstop = () => processAudioBlob(new Blob(chunksRef.current, { type: 'audio/webm' }));
                  mediaRecorderRef.current.start();
                  setIsRecording(true);
                }} className={`w-20 h-20 rounded-full flex items-center justify-center shadow-xl transition-all ${isRecording ? 'bg-rose-500 text-white animate-pulse' : 'bg-white text-rose-500'}`}>
                  <i className={`fas ${isRecording ? 'fa-stop' : 'fa-microphone'} text-2xl`}></i>
                </button>
                <p className="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">{isRecording ? 'Recording...' : t.status_ready}</p>
              </div>
            )}

            {!isIdle && (
              <div className="mt-8 p-6 bg-indigo-50 rounded-3xl space-y-3">
                <div className="flex justify-between items-center text-[10px] font-black text-indigo-600 uppercase">
                  <span>{processing.message}</span>
                  <span>{processing.progress}%</span>
                </div>
                <div className="h-2 bg-white rounded-full overflow-hidden p-0.5"><div className="h-full bg-indigo-600 rounded-full transition-all duration-700" style={{ width: `${processing.progress}%` }}></div></div>
              </div>
            )}

            {result && (
              <div className="mt-10 space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="audio-gradient p-8 rounded-3xl flex items-center justify-between shadow-xl text-white">
                  <div className="flex items-center gap-5">
                    <button onClick={() => {
                      if (isPlaying) { activeSourceRef.current?.stop(); setIsPlaying(false); }
                      else {
                        const audio = new Audio(result.audioUrl);
                        audio.onplay = () => setIsPlaying(true);
                        audio.onended = () => setIsPlaying(false);
                        audio.play();
                      }
                    }} className={`w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-2xl active:scale-90 transition-all ${isPlaying ? 'text-indigo-600' : 'text-slate-900 pl-1'}`}>
                      {isPlaying ? <i className="fas fa-stop"></i> : <i className="fas fa-play"></i>}
                    </button>
                    <div>
                      <p className="font-black text-lg">{isPlaying ? t.result_playing : t.result_listening}</p>
                      <p className="text-white/60 text-[9px] font-bold uppercase tracking-widest">Gemini Neural Voice</p>
                    </div>
                  </div>
                  <a href={result.audioUrl} download="translation.wav" className="px-5 py-3 bg-white/10 rounded-xl text-[10px] font-black border border-white/20 hover:bg-white/20 transition-all flex items-center gap-2">
                    <i className="fas fa-download"></i>{t.result_export}
                  </a>
                </div>

                <div className="bg-slate-900 text-white rounded-3xl p-8">
                  <div className="flex items-center gap-2 mb-4">
                    <i className="fas fa-lightbulb text-indigo-400"></i>
                    <span className="text-[10px] font-black uppercase tracking-widest">{t.result_summary}</span>
                  </div>
                  <div className="space-y-3">
                    {result.summary.map((p, i) => (
                      <p key={i} className="text-slate-300 text-xs font-bold leading-relaxed">• {p}</p>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.result_source}</span>
                    <p className="text-slate-600 text-xs mt-3 leading-relaxed">{result.originalText}</p>
                  </div>
                  <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">
                    <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">{t.result_translation}</span>
                    <p className="text-slate-800 text-sm font-black mt-3 leading-relaxed">{result.translatedText}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
};

export default App;

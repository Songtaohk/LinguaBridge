
import React, { useState, useRef, useEffect } from 'react';
import { AppStatus, TranslationResult, ProcessingState, TargetLanguage } from './types';
import { translateAudio, synthesizeSpeech, resolveAudioLink, translateAndSynthesizeText } from './services/geminiService';
import { createWavBlob, decodeAudioData } from './utils/audioUtils';

type InputMode = 'file' | 'url' | 'record';

const I18N = {
  zh: {
    title: "听懂世界，从一键开始。",
    subtitle: "多语种智能译制专家",
    targetLang: "目标语言",
    mode_file: "本地上传",
    mode_url: "解析网页",
    mode_record: "录制捕捉",
    url_placeholder: "粘贴链接，翻译为中文...",
    url_btn: "解析并翻译",
    guide_toggle_on: "收起安装指南",
    guide_toggle_off: "如何安装“一键翻译”书签",
    guide_step1: "复制代码",
    guide_copy: "点击复制代码",
    guide_copy_success: "复制成功",
    guide_desc: "在浏览器书签管理器中，添加新书签，名称自定，网址粘贴上方代码。",
    upload_title: "上传外语音频",
    upload_desc: "支持 100+ 语种自动识别翻译",
    record_idle: "点击麦克风捕捉网页声音",
    record_active: "正在捕获音频",
    status_ready: "准备就绪",
    status_understanding: "AI 深度理解内容中...",
    status_synthesizing: "正在合成中文配音...",
    status_completed: "译制成功！",
    status_error: "处理中断",
    btn_retry: "重试",
    result_listening: "收听 AI 中文配音",
    result_playing: "正在播报译文...",
    result_export: "导出音频",
    result_summary: "智能摘要",
    result_source: "原文转录 (Source)",
    result_translation: "中文译文 (Translation)",
    deploy_tip_title: "智能链路就绪",
    deploy_tip_desc: "粘贴链接即可翻译。建议收藏页面以备不时之需。",
    initializing: "正在启动 LinguaBridge...",
    auth_title: "连接 LinguaBridge AI",
    auth_desc: "本应用使用 Gemini 高级模型。请选择一个已启用账单的付费项目密钥以开启智能译制功能。",
    auth_btn: "立即连接密钥",
    auth_billing: "了解如何配置付费项目"
  },
  en: {
    title: "Understand the World, Instantly.",
    subtitle: "Multilingual AI Translation Expert",
    targetLang: "Target Language",
    mode_file: "Local Upload",
    mode_url: "Web Resolve",
    mode_record: "Live Capture",
    url_placeholder: "Paste link to translate...",
    url_btn: "Translate Now",
    guide_toggle_on: "Hide Instructions",
    guide_toggle_off: "Install One-Click Bookmarklet",
    guide_step1: "Copy Script",
    guide_copy: "Copy Code",
    guide_copy_success: "Copied!",
    guide_desc: "Add a new bookmark in your browser, and paste the code into the URL field.",
    upload_title: "Upload Audio File",
    upload_desc: "Auto-detects 100+ languages",
    record_idle: "Click to capture system sound",
    record_active: "Capturing Audio",
    status_ready: "Ready",
    status_understanding: "AI is analyzing content...",
    status_synthesizing: "Synthesizing AI voice...",
    status_completed: "Success!",
    status_error: "Processing Failed",
    btn_retry: "Retry",
    result_listening: "Listen to AI Voice",
    result_playing: "Playing Translation...",
    result_export: "Export WAV",
    result_summary: "Key Insights",
    result_source: "Source Transcript",
    result_translation: "Translation",
    deploy_tip_title: "Smart Link Ready",
    deploy_tip_desc: "Paste any link to begin. Save this page to your favorites.",
    initializing: "Launching LinguaBridge...",
    auth_title: "Connect LinguaBridge AI",
    auth_desc: "This app uses premium Gemini models. Please select an API key from a paid project to enable smart translation features.",
    auth_btn: "Connect AI Key",
    auth_billing: "Learn about billing requirements"
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
  const [recordTime, setRecordTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isKeyMissing, setIsKeyMissing] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [showMagicTip, setShowMagicTip] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  const t = I18N[targetLang];
  const appUrl = window.location.href.split('?')[0].split('#')[0];
  const bookmarkletCode = `javascript:(function(){var u='${appUrl}';var t=encodeURIComponent(window.location.href);var w=window.open(u+'?url='+t,'_blank');if(!w||w.closed){alert('Pop-up blocked!');}else{w.focus();}})();`;

  useEffect(() => {
    const msgMap: Record<AppStatus, string> = {
      [AppStatus.IDLE]: t.status_ready,
      [AppStatus.UPLOADING]: t.status_understanding,
      [AppStatus.TRANSCRIBING]: t.status_understanding,
      [AppStatus.SYNTHESIZING]: t.status_synthesizing,
      [AppStatus.COMPLETED]: t.status_completed,
      [AppStatus.ERROR]: t.status_error
    };
    setProcessing(p => ({ ...p, message: msgMap[p.status] }));

    const init = async () => {
      try {
        const hasKey = (window as any).aistudio?.hasSelectedApiKey 
          ? await (window as any).aistudio.hasSelectedApiKey() 
          : !!process.env.API_KEY;

        if (!hasKey) {
          setIsKeyMissing(true);
        }

        const params = new URLSearchParams(window.location.search);
        const externalUrl = params.get('url');
        if (externalUrl) {
          setUrlInput(decodeURIComponent(externalUrl));
          setMode('url');
        }
      } catch (e) {
        console.error("Init Error", e);
      } finally {
        setIsInitializing(false);
      }
    };
    init();
  }, [targetLang]);

  const handleSelectKey = async () => {
    if (typeof (window as any).aistudio?.openSelectKey === 'function') {
      // Rule: MUST assume selection was successful and proceed to app immediately.
      await (window as any).aistudio.openSelectKey();
      setIsKeyMissing(false);
    }
  };

  const stopAudioPlayback = () => {
    if (activeSourceRef.current) {
      try { activeSourceRef.current.stop(); } catch (e) {}
      activeSourceRef.current = null;
    }
    setIsPlaying(false);
  };

  const processAudioBlob = async (blob: Blob) => {
    stopAudioPlayback();
    setResult(null);
    setProcessing({ status: AppStatus.UPLOADING, progress: 20, message: t.status_understanding });
    
    try {
      const translation = await translateAudio(blob, targetLang);
      setProcessing({ status: AppStatus.SYNTHESIZING, progress: 70, message: t.status_synthesizing });
      const pcmData = await synthesizeSpeech(translation.translatedText, targetLang);
      const wavBlob = createWavBlob(pcmData, 24000);
      const audioUrl = URL.createObjectURL(wavBlob);
      setResult({ ...translation, targetLang, audioBlob: wavBlob, audioUrl });
      setProcessing({ status: AppStatus.COMPLETED, progress: 100, message: t.status_completed });
    } catch (error: any) {
      // If error mentions entity not found, re-prompt for key
      if (error.message?.includes("not found")) {
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
        const blob = await res.blob();
        processAudioBlob(blob);
      } else if (sniff.textContent) {
        setProcessing({ status: AppStatus.SYNTHESIZING, progress: 50, message: t.status_synthesizing });
        const textResult = await translateAndSynthesizeText(sniff.textContent, targetLang);
        const wavBlob = createWavBlob(textResult.pcmData, 24000);
        const audioUrl = URL.createObjectURL(wavBlob);
        setResult({ ...textResult, targetLang, audioBlob: wavBlob, audioUrl });
        setProcessing({ status: AppStatus.COMPLETED, progress: 100, message: t.status_completed });
      }
    } catch (err: any) {
      setProcessing({ status: AppStatus.ERROR, progress: 0, message: t.status_error, error: err.message });
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => chunksRef.current.push(e.data);
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        processAudioBlob(blob);
        stream.getTracks().forEach(track => track.stop());
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordTime(0);
      timerRef.current = window.setInterval(() => setRecordTime(prev => prev + 1), 1000);
    } catch (err: any) {
      setProcessing({ status: AppStatus.ERROR, progress: 0, message: t.status_error, error: 'Mic denied.' });
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const toggleAudio = async () => {
    if (isPlaying) { stopAudioPlayback(); return; }
    if (!result?.audioBlob) return;
    if (!audioContextRef.current) audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    const uint8Data = new Uint8Array(await result.audioBlob.arrayBuffer()).slice(44);
    const buffer = await decodeAudioData(uint8Data, audioContextRef.current, 24000, 1);
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => setIsPlaying(false);
    activeSourceRef.current = source;
    source.start();
    setIsPlaying(true);
  };

  const isIdle = processing.status === AppStatus.IDLE || processing.status === AppStatus.COMPLETED || processing.status === AppStatus.ERROR;

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
        <p className="text-slate-400 font-bold tracking-widest text-xs uppercase">{t.initializing}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 pb-20 pt-safe">
      {isKeyMissing && (
        <div className="fixed inset-0 z-[200] bg-slate-900 flex items-center justify-center p-6 sm:p-0">
          <div className="max-w-md w-full text-center space-y-10 animate-in fade-in zoom-in-95 duration-500">
            <div className="w-24 h-24 audio-gradient rounded-[2rem] flex items-center justify-center mx-auto shadow-[0_0_50px_rgba(99,102,241,0.3)] rotate-3">
               <i className="fas fa-bolt-lightning text-white text-4xl"></i>
            </div>
            <div className="space-y-4">
              <h2 className="text-3xl font-black text-white tracking-tight">{t.auth_title}</h2>
              <p className="text-slate-400 text-sm font-medium leading-relaxed px-4">{t.auth_desc}</p>
            </div>
            <div className="space-y-4 px-4">
              <button onClick={handleSelectKey} className="w-full py-5 bg-indigo-600 text-white rounded-2xl font-black shadow-2xl hover:bg-indigo-500 transition-all active:scale-95 text-sm uppercase tracking-wider">
                  {t.auth_btn}
              </button>
              <a 
                href="https://ai.google.dev/gemini-api/docs/billing" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-block text-[11px] font-black text-slate-500 uppercase tracking-widest border-b border-slate-700 pb-0.5 hover:text-indigo-400 hover:border-indigo-400 transition-all"
              >
                {t.auth_billing} <i className="fas fa-external-link-alt ml-1"></i>
              </a>
            </div>
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
          <div className="flex gap-2">
            <button onClick={() => setIsKeyMissing(true)} className="w-9 h-9 bg-slate-100 rounded-xl flex items-center justify-center text-slate-500 hover:text-indigo-600 transition-colors">
              <i className="fas fa-key text-xs"></i>
            </button>
            <div className="flex bg-slate-100 p-1 rounded-xl">
               <button onClick={() => setTargetLang('zh')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${targetLang === 'zh' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>中文</button>
               <button onClick={() => setTargetLang('en')} className={`px-3 py-1.5 rounded-lg text-[10px] font-black transition-all ${targetLang === 'en' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400'}`}>English</button>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 mt-12 sm:mt-20 space-y-12">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-slate-200 text-indigo-500 rounded-full text-[10px] font-black uppercase tracking-widest shadow-sm">
             <i className="fas fa-sparkles"></i> {t.subtitle}
          </div>
          <h1 className="text-4xl sm:text-6xl font-black tracking-tighter leading-tight px-4">
            {t.title.split(/[，,]/).map((c, i, a) => (
              <React.Fragment key={i}>{c}{i < a.length - 1 ? (targetLang === 'zh' ? '，' : ',') : ''}{i < a.length - 1 && <br/>}</React.Fragment>
            ))}
          </h1>
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
              <div className="space-y-6">
                <div className="relative group">
                  <input type="url" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} placeholder={t.url_placeholder} className="w-full pl-6 pr-32 py-5 rounded-2xl bg-slate-50 border-2 border-transparent focus:border-indigo-500 focus:bg-white outline-none transition-all text-sm font-bold shadow-inner" />
                  <button onClick={handleUrlSubmit} className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 text-white rounded-xl font-black text-[10px] uppercase hover:bg-slate-900 transition-all shadow-md">{t.url_btn}</button>
                </div>
                <button onClick={() => setShowMagicTip(!showMagicTip)} className="w-full py-2 text-[9px] font-black text-slate-400 hover:text-indigo-600 uppercase tracking-widest transition-colors">{showMagicTip ? t.guide_toggle_on : t.guide_toggle_off}</button>
                {showMagicTip && (
                  <div className="p-6 bg-slate-900 rounded-3xl space-y-4 shadow-xl animate-in zoom-in-95">
                    <div className="flex justify-between items-center">
                       <p className="text-[11px] text-white font-black">{t.guide_step1}</p>
                       <button onClick={async () => { await navigator.clipboard.writeText(bookmarkletCode); setCopySuccess(true); setTimeout(() => setCopySuccess(false), 2000); }} className={`px-4 py-2 rounded-lg text-[9px] font-black uppercase transition-all ${copySuccess ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white'}`}>{copySuccess ? t.guide_copy_success : t.guide_copy}</button>
                    </div>
                    <p className="text-[10px] text-slate-400 leading-relaxed font-medium">{t.guide_desc}</p>
                  </div>
                )}
              </div>
            )}

            {mode === 'file' && (
              <div onClick={() => isIdle && fileInputRef.current?.click()} className={`border-2 border-dashed rounded-3xl p-12 text-center transition-all ${isIdle ? 'border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/30 cursor-pointer' : 'opacity-50'}`}>
                <input type="file" ref={fileInputRef} onChange={(e) => e.target.files?.[0] && processAudioBlob(e.target.files[0])} className="hidden" accept="audio/*" />
                <div className="w-16 h-16 mx-auto rounded-2xl flex items-center justify-center mb-4 bg-indigo-50 text-indigo-600"><i className="fas fa-cloud-arrow-up text-2xl"></i></div>
                <h3 className="text-lg font-black text-slate-800">{t.upload_title}</h3>
                <p className="mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t.upload_desc}</p>
              </div>
            )}

            {mode === 'record' && (
              <div className="flex flex-col items-center justify-center py-10 rounded-3xl bg-slate-50">
                {!isRecording ? (
                  <button onClick={startRecording} className="w-20 h-20 rounded-full bg-white text-rose-500 flex items-center justify-center hover:scale-110 active:scale-95 shadow-xl transition-all"><i className="fas fa-microphone text-2xl"></i></button>
                ) : (
                  <button onClick={stopRecording} className="w-20 h-20 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xl animate-pulse"><i className="fas fa-stop text-2xl"></i></button>
                )}
                <p className="mt-6 text-[10px] font-black text-slate-400 uppercase tracking-widest">{isRecording ? `${t.record_active} (${recordTime}s)` : t.record_idle}</p>
              </div>
            )}

            {!isIdle && (
              <div className="mt-8 p-6 bg-indigo-50 rounded-3xl space-y-3">
                <div className="flex justify-between items-center text-[10px] font-black text-indigo-600 uppercase">
                  <div className="flex items-center gap-2"><div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>{processing.message}</div>
                  <span>{processing.progress}%</span>
                </div>
                <div className="h-2 bg-white rounded-full overflow-hidden p-0.5"><div className="h-full bg-indigo-600 rounded-full transition-all duration-700" style={{ width: `${processing.progress}%` }}></div></div>
              </div>
            )}

            {result && (
              <div className="mt-10 space-y-8 animate-in fade-in slide-in-from-bottom-4">
                <div className="audio-gradient p-8 rounded-3xl flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl text-white">
                  <div className="flex items-center gap-5">
                    <button onClick={toggleAudio} className={`w-16 h-16 rounded-2xl bg-white flex items-center justify-center text-2xl active:scale-90 transition-all ${isPlaying ? 'text-indigo-600' : 'text-slate-900 pl-1'}`}>
                      {isPlaying ? <i className="fas fa-stop"></i> : <i className="fas fa-play"></i>}
                    </button>
                    <div>
                      <p className="font-black text-lg">{isPlaying ? t.result_playing : t.result_listening}</p>
                      <p className="text-white/60 text-[9px] font-bold uppercase tracking-widest">Neural AI Voice Engine</p>
                    </div>
                  </div>
                  <a href={result.audioUrl} download="translation.wav" className="px-5 py-3 bg-white/10 rounded-xl text-[10px] font-black border border-white/20 hover:bg-white/20 transition-all flex items-center gap-2">
                    <i className="fas fa-download"></i>{t.result_export}
                  </a>
                </div>

                <div className="bg-slate-900 text-white rounded-3xl p-8 shadow-lg">
                  <div className="flex items-center gap-2 px-2.5 py-1 bg-white/10 rounded-full w-fit mb-4">
                    <i className="fas fa-lightbulb text-indigo-400 text-[10px]"></i><span className="text-[9px] font-black uppercase tracking-widest">{t.result_summary}</span>
                  </div>
                  <div className="space-y-3">
                    {result.summary.map((p, i) => (
                      <div key={i} className="flex gap-3 items-start">
                        <span className="w-4 h-4 rounded bg-indigo-500/30 text-indigo-300 flex items-center justify-center text-[9px] font-black shrink-0">{i + 1}</span>
                        <p className="text-slate-300 text-xs font-bold leading-relaxed">{p}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                  <div className="bg-slate-50 p-6 rounded-3xl">
                    <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest">{t.result_source}</span>
                    <p className="text-slate-600 text-xs leading-relaxed font-medium mt-3">{result.originalText}</p>
                  </div>
                  <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100">
                    <span className="text-[9px] font-black text-indigo-500 uppercase tracking-widest">{t.result_translation}</span>
                    <p className="text-slate-800 text-sm font-black leading-snug mt-3">{result.translatedText}</p>
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

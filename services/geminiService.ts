
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { blobToBase64, decode } from "../utils/audioUtils";
import { TargetLanguage } from "../types";

/**
 * Enhanced Link Resolver: Now handles audio sniffing AND text-to-audio fallback.
 * Uses internal initialization to ensure fresh API key usage.
 */
export const resolveAudioLink = async (pageUrl: string): Promise<{ url?: string, textContent?: string, sourceName?: string }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: [
      {
        parts: [
          {
            text: `Target URL: ${pageUrl}. 
            
            Task:
            1. Search for a direct MP3/M4A/WebM audio link (e.g., from <audio> tags, RSS feeds, or media CDNs).
            2. If it's a YouTube/Bilibili link and direct access is blocked, look for a reliable third-party proxy URL or a high-quality alternative source.
            3. CRITICAL FALLBACK: If NO audio is found (like on a standard blog), extract the main article content (headline and body text) so we can read it to the user.
            
            Return JSON: { 
              "url": "direct_link or null", 
              "textContent": "extracted article text if no audio found",
              "sourceName": "platform_name", 
              "isProtected": boolean 
            }`
          }
        ]
      }
    ],
    config: {
      tools: [{ googleSearch: {} }],
      thinkingConfig: { thinkingBudget: 32768 },
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          url: { type: Type.STRING },
          textContent: { type: Type.STRING },
          sourceName: { type: Type.STRING },
          isProtected: { type: Type.BOOLEAN }
        },
        required: ["sourceName"]
      }
    }
  });

  try {
    const data = JSON.parse(response.text || "{}");
    if (data.url && data.url.startsWith('http') && !data.isProtected) {
      return { url: data.url, sourceName: data.sourceName };
    }
    if (data.textContent && data.textContent.length > 50) {
      return { textContent: data.textContent, sourceName: data.sourceName };
    }
    if (data.isProtected) {
      throw new Error("该网站设置了高级反爬虫保护。AI 无法直接穿透防护获取内容。");
    }
    throw new Error("未能在页面中发现可识别的音频或文章内容。");
  } catch (e: any) {
    throw new Error(e.message || "解析链路中断。");
  }
};

/**
 * Translate Audio: Supports dynamic target language.
 */
export const translateAudio = async (audioBlob: Blob, targetLang: TargetLanguage): Promise<{ originalText: string, translatedText: string, summary: string[] }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const base64Data = await blobToBase64(audioBlob);

  const langName = targetLang === 'zh' ? '中文' : 'English';
  const langAction = targetLang === 'zh' ? '信达雅的中文' : 'natural and professional English';

  const response = await ai.models.generateContent({
    model: "gemini-3-pro-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              data: base64Data,
              mimeType: audioBlob.type || 'audio/mpeg'
            }
          },
          {
            text: `请识别该音频内容的语种。将其精准转录并翻译成${langAction}。同时用${langName}提供3个核心要点总结。`
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          original: { type: Type.STRING, description: "Transcription in source language" },
          translated: { type: Type.STRING, description: `Translation in ${langName}` },
          summary: { type: Type.ARRAY, items: { type: Type.STRING }, description: `Summary in ${langName}` }
        },
        required: ["original", "translated", "summary"]
      }
    }
  });

  const data = JSON.parse(response.text || "{}");
  return {
    originalText: data.original || "",
    translatedText: data.translated || "",
    summary: data.summary || []
  };
};

/**
 * Translates and synthesizes from text with language selection.
 */
export const translateAndSynthesizeText = async (text: string, targetLang: TargetLanguage): Promise<{ originalText: string, translatedText: string, summary: string[], pcmData: Uint8Array }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const langName = targetLang === 'zh' ? '中文' : 'English';

  const transResponse = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [{ parts: [{ text: `自动检测以下内容的语种，并将其翻译成通顺自然的${langName}，并用${langName}总结3个要点：\n\n${text.substring(0, 5000)}` }] }],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          translated: { type: Type.STRING },
          summary: { type: Type.ARRAY, items: { type: Type.STRING } }
        },
        required: ["translated", "summary"]
      }
    }
  });
  
  const transData = JSON.parse(transResponse.text || "{}");
  const pcmData = await synthesizeSpeech(transData.translated, targetLang);
  
  return {
    originalText: text.substring(0, 500),
    translatedText: transData.translated,
    summary: transData.summary,
    pcmData
  };
};

/**
 * TTS synthesis with voice switching.
 */
export const synthesizeSpeech = async (text: string, targetLang: TargetLanguage): Promise<Uint8Array> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const voiceName = targetLang === 'zh' ? 'Kore' : 'Zephyr'; // Zephyr for English, Kore for Chinese

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text: text.substring(0, 1000) }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) throw new Error("Voice synthesis failed");
  return decode(base64Audio);
};


import { GoogleGenAI, Type } from "@google/genai";
import { ChapterData, NuggetType } from "../types";

const COST_PER_1M_INPUT = 0.075;
const COST_PER_1M_OUTPUT = 0.30;

export const calculateCost = (inputTokens: number, outputTokens: number) => {
  return (inputTokens / 1000000 * COST_PER_1M_INPUT) + (outputTokens / 1000000 * COST_PER_1M_OUTPUT);
};

export const scanChapterForNuggets = async (
  chapterText: string, 
  chapterIndex: number, 
  locationLabel: string,
  analyzeBackMatter: boolean = false,
  analyzeFrontMatter: boolean = false
): Promise<{ data: ChapterData; usage: { input: number; output: number } }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze this section of a book (Section ${chapterIndex + 1}, ${locationLabel}).
    EXTRACT ALL noteworthy insights, learning points, or direct quotes. 
    DO NOT limit yourself to a fixed number. If the text is dense with value, extract more. 
    
    CRITICAL CLASSIFICATION:
    - Identify if this is "Front Matter" (e.g., Table of Contents, Preface, Foreword, Introduction, Copyright, Title Page).
    - Identify if this is "Back Matter" (e.g., References, Index, Bibliography, Acknowledgments, Appendix).

    TEXT:
    ${chapterText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          isBackMatter: { type: Type.BOOLEAN, description: "True if this is bibliography, index, appendix, etc." },
          isFrontMatter: { type: Type.BOOLEAN, description: "True if this is Preface, ToC, Introduction, etc." },
          nuggets: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING, enum: [NuggetType.QUOTE, NuggetType.LEARNING, NuggetType.INSIGHT] },
                content: { type: Type.STRING },
                source: { type: Type.STRING }
              },
              required: ["id", "type", "content"]
            }
          }
        },
        required: ["title", "nuggets", "isBackMatter", "isFrontMatter"]
      }
    }
  });

  const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
  const jsonStr = response.text || "{}";
  const rawData = JSON.parse(jsonStr.trim());
  
  const skipBecauseBackMatter = rawData.isBackMatter && !analyzeBackMatter;
  const skipBecauseFrontMatter = rawData.isFrontMatter && !analyzeFrontMatter;

  if (skipBecauseBackMatter || skipBecauseFrontMatter) {
    return { 
      data: { title: rawData.title, isBackMatter: !!rawData.isBackMatter, isFrontMatter: !!rawData.isFrontMatter, nuggets: [] }, 
      usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount } 
    };
  }

  const data: ChapterData = {
    ...rawData,
    nuggets: rawData.nuggets.map((n: any, idx: number) => ({
      ...n,
      id: `c${chapterIndex}_${n.id}`,
      locationLabel,
      sortIndex: idx
    }))
  };

  return { data, usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount } };
};

export const recallSearch = async (query: string, bookTitle: string, contextChunks: string[]): Promise<any> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `The user is looking for something specific in the book "${bookTitle}".
    Carefully find any information matching: "${query}".
    Look for specific quotes, learning points, or insights.
    
    Context from book:
    ${contextChunks.join("\n\n---\n\n")}
    `,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          found: { type: Type.BOOLEAN },
          result: {
            type: Type.OBJECT,
            properties: {
              content: { type: Type.STRING },
              type: { type: Type.STRING, enum: ["quote", "learning", "insight"] },
              source: { type: Type.STRING }
            }
          }
        }
      }
    }
  });
  return JSON.parse(response.text || "{}");
};

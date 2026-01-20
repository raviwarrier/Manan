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
  analyzeBoilerplate: boolean = false,
  selectedTypes: NuggetType[] = [NuggetType.QUOTE, NuggetType.LEARNING, NuggetType.INSIGHT]
): Promise<{ data: ChapterData; usage: { input: number; output: number } }> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  
  const typeInstructions = selectedTypes.length > 0 
    ? `ONLY extract the following types: ${selectedTypes.join(", ")}.`
    : "Extract all noteworthy insights, learning points, or direct quotes.";

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Analyze this section of a book (Section ${chapterIndex + 1}, ${locationLabel}).
    ${typeInstructions}
    
    CRITICAL INSTRUCTIONS FOR ATTRIBUTION:
    - For every QUOTE or specific INSIGHT, you MUST identify the original author if mentioned.
    - If the author is the book's main author, attribute it to them.
    - If it's a quote from a third-party (e.g. Einstein, Jobs, etc.) mentioned in the text, attribute it to them.
    - Populate the 'source' field with the Author name and any specific page/context if found.

    CRITICAL CLASSIFICATION:
    - Determine if this section is "Boilerplate Front Matter" (Copyright, Table of Contents, Dedication, Acknowledgements, Foreword by others).
    - Determine if this section is "Content Front Matter" (Introduction, Preface, Prologue, Author's Note).
    - Determine if this section is "Body" (Standard chapters).
    - Determine if this section is "Back Matter" (Index, Bibliography, References).

    Mark 'isBoilerplate' as true ONLY for the "Boilerplate Front Matter" category.
    "Content Front Matter" (Introduction, etc.) should be marked as false for isBoilerplate and analyzed for insights.

    TEXT:
    ${chapterText}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          isBoilerplate: { type: Type.BOOLEAN, description: "True if this is Copyright, ToC, Dedication, etc." },
          isBackMatter: { type: Type.BOOLEAN, description: "True if this is bibliography, index, appendix." },
          nuggets: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                type: { type: Type.STRING, enum: [NuggetType.QUOTE, NuggetType.LEARNING, NuggetType.INSIGHT] },
                content: { type: Type.STRING },
                source: { type: Type.STRING, description: "Author name or source reference." }
              },
              required: ["id", "type", "content"]
            }
          }
        },
        required: ["title", "nuggets", "isBoilerplate", "isBackMatter"]
      }
    }
  });

  const usage = response.usageMetadata || { promptTokenCount: 0, candidatesTokenCount: 0 };
  const jsonStr = response.text || "{}";
  const rawData = JSON.parse(jsonStr.trim());
  
  const skipBecauseBoilerplate = rawData.isBoilerplate && !analyzeBoilerplate;
  const skipBecauseBackMatter = rawData.isBackMatter && !analyzeBackMatter;

  if (skipBecauseBoilerplate || skipBecauseBackMatter) {
    return { 
      data: { 
        title: rawData.title, 
        isBackMatter: !!rawData.isBackMatter, 
        isFrontMatter: !!rawData.isBoilerplate, 
        nuggets: [] 
      }, 
      usage: { input: usage.promptTokenCount, output: usage.candidatesTokenCount } 
    };
  }

  const filteredNuggets = rawData.nuggets.filter((n: any) => selectedTypes.includes(n.type as NuggetType));

  const data: ChapterData = {
    ...rawData,
    isFrontMatter: rawData.isBoilerplate,
    nuggets: filteredNuggets.map((n: any, idx: number) => ({
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
    contents: `Searching in "${bookTitle}" for: "${query}".
    Find exact matches, quotes, or specific facts.
    Attribute quotes to authors.
    
    Context:
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

import * as pdfjsLib from 'pdfjs-dist';
import JSZip from 'jszip';

const PDFJS_VERSION = '4.10.38';
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

export const parsePdf = async (file: File): Promise<{ title: string; chunks: string[]; locations: string[] }> => {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  
  const chunks: string[] = [];
  const locations: string[] = [];
  
  // We process 3 pages at a time as a "chapter/chunk" to maintain context
  for (let i = 1; i <= pdf.numPages; i += 3) {
    let chunkText = '';
    const end = Math.min(i + 2, pdf.numPages);
    for (let p = i; p <= end; p++) {
      const page = await pdf.getPage(p);
      const textContent = await page.getTextContent();
      chunkText += textContent.items.map((item: any) => item.str || '').join(' ') + '\n\n';
    }
    chunks.push(chunkText);
    locations.push(i === end ? `Page ${i}` : `Pages ${i}-${end}`);
  }

  return { title: file.name.replace('.pdf', ''), chunks, locations };
};

export const parseEpub = async (file: File): Promise<{ title: string; chunks: string[]; locations: string[] }> => {
  const zip = new JSZip();
  const content = await zip.loadAsync(file);
  const chunks: string[] = [];
  const locations: string[] = [];
  
  const fileNames = Object.keys(content.files).sort();
  let count = 0;
  for (const name of fileNames) {
    if (name.endsWith('.xhtml') || name.endsWith('.html')) {
      const htmlContent = await content.files[name].async('string');
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlContent, 'text/html');
      const text = doc.body.innerText || doc.body.textContent || '';
      if (text.trim().length > 100) {
        chunks.push(text);
        locations.push(`Section ${++count}`);
      }
    }
  }

  return { title: file.name.replace('.epub', ''), chunks, locations };
};

export const chunkText = (text: string, chunkSize: number = 8000): string[] => {
  const chunks: string[] = [];
  let startIndex = 0;
  while (startIndex < text.length) {
    let endIndex = startIndex + chunkSize;
    if (endIndex < text.length) {
      const nextNewline = text.indexOf('\n\n', endIndex);
      if (nextNewline !== -1 && nextNewline < endIndex + 1000) endIndex = nextNewline;
    }
    chunks.push(text.slice(startIndex, endIndex));
    startIndex = endIndex;
  }
  return chunks;
};

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { parsePdf, parseEpub } from './services/bookParser';
import { scanChapterForNuggets, calculateCost, recallSearch } from './services/geminiService';
import { Book, ChapterData, NoteItem, NuggetType, BookNugget, UsageStats } from './types';

const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => 
    localStorage.getItem('theme') as 'light' | 'dark' || 'light'
  );
  const [book, setBook] = useState<Book | null>(null);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentChapterData, setCurrentChapterData] = useState<ChapterData | null>(null);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<UsageStats>({ totalInputTokens: 0, totalOutputTokens: 0, estimatedCost: 0 });
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [analyzeBackMatter, setAnalyzeBackMatter] = useState(false);
  const [analyzeFrontMatter, setAnalyzeFrontMatter] = useState(false);

  const cachedChapters = useRef<Map<number, ChapterData>>(new Map());
  const isPrefetching = useRef<boolean>(false);

  const storageKey = book ? `manan_progress_${book.title.replace(/\s/g, '_')}` : null;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    if (storageKey) {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setCurrentChapterIndex(parsed.chapterIndex || 0);
          setNotes(parsed.notes || []);
          setStats(parsed.stats || { totalInputTokens: 0, totalOutputTokens: 0, estimatedCost: 0 });
        } catch (e) {
          console.error("Error loading progress", e);
        }
      }
    }
  }, [storageKey]);

  useEffect(() => {
    if (storageKey && book) {
      localStorage.setItem(storageKey, JSON.stringify({
        chapterIndex: currentChapterIndex,
        notes,
        stats
      }));
    }
  }, [currentChapterIndex, notes, stats, storageKey, book]);

  const prefetchNext = useCallback(async (index: number) => {
    if (!book || index >= book.chapters.length || cachedChapters.current.has(index) || isPrefetching.current) return;
    
    isPrefetching.current = true;
    try {
      const result = await scanChapterForNuggets(
        book.chapters[index], 
        index, 
        book.chapterLocations[index], 
        analyzeBackMatter,
        analyzeFrontMatter
      );
      cachedChapters.current.set(index, result.data);
      setStats(prev => {
        const newCost = calculateCost(result.usage.input, result.usage.output);
        return {
          totalInputTokens: prev.totalInputTokens + result.usage.input,
          totalOutputTokens: prev.totalOutputTokens + result.usage.output,
          estimatedCost: prev.estimatedCost + newCost
        };
      });
    } catch (e) {
      console.warn("Prefetch failed", e);
    } finally {
      isPrefetching.current = false;
    }
  }, [book, analyzeBackMatter, analyzeFrontMatter]);

  const analyzeChapter = useCallback(async (index: number) => {
    if (!book) return;
    
    if (cachedChapters.current.has(index)) {
      setCurrentChapterData(cachedChapters.current.get(index)!);
      setTimeout(() => prefetchNext(index + 1), 500);
      return;
    }

    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await scanChapterForNuggets(
        book.chapters[index], 
        index, 
        book.chapterLocations[index], 
        analyzeBackMatter,
        analyzeFrontMatter
      );
      setCurrentChapterData(result.data);
      cachedChapters.current.set(index, result.data);
      setStats(prev => {
        const newCost = calculateCost(result.usage.input, result.usage.output);
        return {
          totalInputTokens: prev.totalInputTokens + result.usage.input,
          totalOutputTokens: prev.totalOutputTokens + result.usage.output,
          estimatedCost: prev.estimatedCost + newCost
        };
      });
      setTimeout(() => prefetchNext(index + 1), 500);
    } catch (err) {
      setError('Analysis failed. Please check your internet connection and API key.');
    } finally {
      setIsAnalyzing(false);
    }
  }, [book, prefetchNext, analyzeBackMatter, analyzeFrontMatter]);

  useEffect(() => {
    if (book && !isAnalyzing) {
      analyzeChapter(currentChapterIndex);
    }
  }, [book, currentChapterIndex, analyzeChapter]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (!uploadedFile) return;

    setIsProcessing(true);
    setError(null);
    cachedChapters.current.clear();

    try {
      let result;
      if (uploadedFile.name.toLowerCase().endsWith('.pdf')) {
        result = await parsePdf(uploadedFile);
      } else if (uploadedFile.name.toLowerCase().endsWith('.epub')) {
        result = await parseEpub(uploadedFile);
      } else {
        throw new Error('Unsupported format. Please upload PDF or EPUB.');
      }

      setBook({
        title: result.title,
        chapters: result.chunks,
        chapterLocations: result.locations
      });
      setCurrentChapterIndex(0);
    } catch (err: any) {
      setError(err.message || 'Error parsing book');
    } finally {
      setIsProcessing(false);
    }
  };

  const toggleNote = (nugget: BookNugget) => {
    const exists = notes.find(n => n.id === nugget.id);
    if (exists) {
      setNotes(notes.filter(n => n.id !== nugget.id));
    } else {
      const newNote: NoteItem = {
        id: nugget.id,
        content: nugget.content,
        type: nugget.type,
        chapterTitle: currentChapterData?.title || `Section ${currentChapterIndex + 1}`,
        chapterIndex: currentChapterIndex,
        sortIndex: nugget.sortIndex,
        locationLabel: nugget.locationLabel
      };
      const newNotes = [...notes, newNote].sort((a, b) => {
        if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex;
        return a.sortIndex - b.sortIndex;
      });
      setNotes(newNotes);
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() || !book) return;
    
    setIsSearching(true);
    try {
      const start = Math.max(0, currentChapterIndex - 2);
      const end = Math.min(book.chapters.length, currentChapterIndex + 3);
      const chunksToSearch = book.chapters.slice(start, end);
      
      const found = await recallSearch(searchQuery, book.title, chunksToSearch);
      if (found && found.found) {
        const nugget: BookNugget = {
          id: `search_${Date.now()}`,
          ...found.result,
          sortIndex: 9999,
          locationLabel: "Deep Search Discovery"
        };
        toggleNote(nugget);
        setSearchQuery('');
      } else {
        alert("Manan couldn't find a precise match in the current context.");
      }
    } catch (e) {
      console.error(e);
      alert("Search failed. Please try again.");
    } finally {
      setIsSearching(false);
    }
  };

  const downloadNotes = () => {
    if (notes.length === 0) return;
    let markdown = `# Reading Notes: ${book?.title}\n\n`;
    
    const grouped: Record<string, NoteItem[]> = {};
    notes.forEach(n => {
      if (!grouped[n.chapterTitle]) grouped[n.chapterTitle] = [];
      grouped[n.chapterTitle].push(n);
    });

    Object.keys(grouped).forEach(title => {
      markdown += `## ${title}\n\n`;
      grouped[title].forEach(item => {
        const loc = item.locationLabel ? ` (${item.locationLabel})` : '';
        if (item.type === NuggetType.QUOTE) markdown += `> ${item.content}${loc}\n\n`;
        else if (item.type === NuggetType.LEARNING) markdown += `* **Key Learning:** ${item.content}${loc}\n\n`;
        else markdown += `* ${item.content}${loc}\n\n`;
      });
    });

    const blob = new Blob([markdown], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${book?.title}_Summary.md`;
    a.click();
    
    if (confirm("Notes exported successfully. Clear current book session?")) {
      if (storageKey) localStorage.removeItem(storageKey);
      reset();
    }
  };

  const reset = () => {
    setBook(null);
    setNotes([]);
    setCurrentChapterIndex(0);
    setCurrentChapterData(null);
    cachedChapters.current.clear();
    setStats({ totalInputTokens: 0, totalOutputTokens: 0, estimatedCost: 0 });
  };

  return (
    <div className="min-h-screen bg-gh-light-bg dark:bg-gh-dark-bg text-gh-light-text dark:text-gh-dark-text flex flex-col font-sans transition-colors duration-300">
      <header className="bg-white/80 dark:bg-gh-dark-sub/80 border-b border-gh-light-border dark:border-gh-dark-border px-6 py-3 sticky top-0 z-50 flex flex-col md:flex-row justify-between items-center gap-4 shadow-sm backdrop-blur-lg">
        <div className="flex items-center gap-4 group">
          <div className="w-12 h-12 overflow-hidden rounded-xl bg-white border-2 border-manan-primary dark:border-manan-dark flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform duration-300">
            {/* Improved image path handling */}
            <img 
              src="images/logo.png" 
              alt="Manan Logo" 
              className="w-full h-full object-contain p-1"
              onError={(e) => {
                console.warn("Logo load failed, using fallback");
                const target = e.target as HTMLImageElement;
                target.src = 'https://img.icons8.com/color/96/blue-footed-booby.png';
              }}
            />
          </div>
          <div className="flex flex-col">
            <h1 className="text-2xl font-black tracking-tighter text-manan-dark dark:text-manan-primary leading-none">Manan</h1>
            {book && <p className="text-[9px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest truncate max-w-[120px] mt-1">{book.title}</p>}
          </div>
        </div>

        {book && (
          <form 
            onSubmit={handleSearch}
            className="flex-1 max-w-lg w-full relative group"
          >
            <input 
              type="text"
              placeholder="Search for specific quotes or facts..."
              className="w-full bg-gh-light-sub dark:bg-gh-dark-bg border border-gh-light-border dark:border-gh-dark-border rounded-xl pl-5 pr-12 py-2.5 text-sm focus:ring-4 ring-manan-primary/20 outline-none transition-all placeholder-gh-light-muted dark:placeholder-gh-dark-muted shadow-inner"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button 
              type="submit"
              disabled={isSearching}
              className="absolute right-1.5 top-1.5 w-9 h-9 rounded-lg bg-manan-primary/10 text-manan-dark dark:text-manan-primary flex items-center justify-center hover:bg-manan-primary hover:text-white transition-all disabled:opacity-50"
            >
              <i className={`fas ${isSearching ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'} text-base`}></i>
            </button>
          </form>
        )}

        <div className="flex items-center gap-6">
          <div className="text-right hidden xl:block">
            <p className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted uppercase font-black leading-none mb-1">Session Cost</p>
            <p className="text-sm font-mono text-emerald-600 dark:text-emerald-400 font-black">${stats.estimatedCost.toFixed(5)}</p>
          </div>
          <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="w-10 h-10 rounded-xl flex items-center justify-center bg-gh-light-sub dark:bg-gh-dark-bg text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-primary border border-gh-light-border dark:border-gh-dark-border transition-all"
          >
            <i className={`fas ${theme === 'light' ? 'fa-moon' : 'fa-sun'} text-lg`}></i>
          </button>
          {book && (
            <button 
              onClick={reset} 
              className="w-10 h-10 rounded-xl flex items-center justify-center bg-red-50 dark:bg-red-900/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-200 dark:border-red-900/30 transition-all" 
              title="Close Book"
            >
              <i className="fas fa-xmark text-lg"></i>
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <div className="flex-1 overflow-y-auto p-4 md:p-10 space-y-10 scroll-smooth">
          {!book ? (
            <div className="max-w-2xl mx-auto mt-20 text-center">
               <div className="w-40 h-40 bg-white dark:bg-gh-dark-sub rounded-[2.5rem] flex items-center justify-center mx-auto mb-10 border-8 border-manan-primary/20 shadow-2xl overflow-hidden p-4 group">
                 <img 
                   src="images/logo.png" 
                   alt="Manan Bird Logo" 
                   className="w-full h-full object-contain group-hover:scale-110 transition-transform duration-500"
                   onError={(e) => {
                     const target = e.target as HTMLImageElement;
                     target.src = 'https://img.icons8.com/color/96/blue-footed-booby.png';
                   }}
                 />
               </div>
               <h2 className="text-5xl font-black mb-6 tracking-tighter text-manan-dark dark:text-manan-primary">Distill your reading.</h2>
               <p className="text-gh-light-muted dark:text-gh-dark-muted mb-12 text-2xl font-medium leading-relaxed max-w-lg mx-auto">
                 Automatically extract quotes, insights, and key lessons from your books while you read.
               </p>
               
               <label className="cursor-pointer inline-flex items-center group">
                <input type="file" className="hidden" accept=".pdf,.epub" onChange={handleFileUpload} disabled={isProcessing} />
                <div className={`px-14 py-5 bg-manan-dark dark:bg-manan-primary text-white dark:text-gh-dark-bg rounded-2xl font-black text-xl hover:scale-105 transition-all flex items-center gap-4 shadow-xl active:scale-95 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                  <i className={`fas ${isProcessing ? 'fa-compass fa-spin' : 'fa-feather-pointed'}`}></i>
                  <span>{isProcessing ? 'Parsing Knowledge...' : 'Upload New Book'}</span>
                </div>
               </label>
               {error && <div className="mt-8 p-5 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border-2 border-red-100 dark:border-red-900/20 rounded-2xl text-sm font-black">{error}</div>}
               
               <div className="mt-20 grid grid-cols-3 gap-8 opacity-40 grayscale group-hover:grayscale-0 transition-all">
                 <div className="flex flex-col items-center gap-2">
                   <i className="fas fa-file-pdf text-3xl"></i>
                   <span className="text-[10px] font-black uppercase">PDF Support</span>
                 </div>
                 <div className="flex flex-col items-center gap-2">
                   <i className="fas fa-book text-3xl"></i>
                   <span className="text-[10px] font-black uppercase">EPUB Support</span>
                 </div>
                 <div className="flex flex-col items-center gap-2">
                   <i className="fas fa-bolt-lightning text-3xl"></i>
                   <span className="text-[10px] font-black uppercase">AI Distillation</span>
                 </div>
               </div>
            </div>
          ) : (
            <div className="max-w-5xl mx-auto space-y-8 pb-32">
              <div className="bg-white dark:bg-gh-dark-sub p-8 rounded-3xl border border-gh-light-border dark:border-gh-dark-border flex flex-wrap items-center justify-between gap-8 shadow-sm">
                <div className="flex-1 min-w-[250px] space-y-2">
                  <h2 className="text-2xl font-black text-manan-dark dark:text-manan-primary truncate leading-tight">{currentChapterData?.title || 'Segment Analysis...'}</h2>
                  <div className="flex items-center gap-4">
                    <span className="text-xs font-black bg-manan-primary/10 text-manan-dark dark:text-manan-primary px-4 py-1.5 rounded-full border border-manan-primary/20">{book.chapterLocations[currentChapterIndex]}</span>
                    <span className="text-[10px] font-black text-gh-light-muted dark:text-gh-dark-muted uppercase tracking-widest">Part {currentChapterIndex + 1} of {book.chapters.length}</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => {
                      setCurrentChapterIndex(i => Math.max(0, i - 1));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    disabled={currentChapterIndex === 0 || isAnalyzing}
                    className="w-14 h-14 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center justify-center hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 transition-all shadow-sm active:scale-90"
                  >
                    <i className="fas fa-arrow-left text-xl"></i>
                  </button>
                  
                  <div className="hidden md:flex px-6 items-center gap-4">
                    <input 
                      type="range" 
                      min="0" 
                      max={book.chapters.length - 1} 
                      value={currentChapterIndex} 
                      onChange={(e) => setCurrentChapterIndex(parseInt(e.target.value))}
                      className="w-40 cursor-pointer"
                    />
                  </div>

                  <button 
                    onClick={() => {
                      setCurrentChapterIndex(i => Math.min(book.chapters.length - 1, i + 1));
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    disabled={currentChapterIndex === book.chapters.length - 1 || isAnalyzing}
                    className="w-14 h-14 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center justify-center hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 transition-all shadow-sm active:scale-90"
                  >
                    <i className="fas fa-arrow-right text-xl"></i>
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-center md:justify-end gap-10 px-4">
                 <div className="flex items-center gap-4 group cursor-help" title="Include Tables of Content, Forewords, etc.">
                    <span className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest">Front-Matter</span>
                    <button 
                      onClick={() => setAnalyzeFrontMatter(!analyzeFrontMatter)}
                      className={`w-12 h-6.5 rounded-full transition-all relative shadow-inner p-1 ${analyzeFrontMatter ? 'bg-manan-primary' : 'bg-gh-light-border dark:bg-gh-dark-border'}`}
                    >
                      <div className={`w-4.5 h-4.5 bg-white rounded-full shadow-md transition-all transform ${analyzeFrontMatter ? 'translate-x-5.5' : 'translate-x-0'}`}></div>
                    </button>
                 </div>
                 <div className="flex items-center gap-4 group cursor-help" title="Include Indexes, Appendices, etc.">
                    <span className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest">Back-Matter</span>
                    <button 
                      onClick={() => setAnalyzeBackMatter(!analyzeBackMatter)}
                      className={`w-12 h-6.5 rounded-full transition-all relative shadow-inner p-1 ${analyzeBackMatter ? 'bg-manan-primary' : 'bg-gh-light-border dark:border-gh-dark-border'}`}
                    >
                      <div className={`w-4.5 h-4.5 bg-white rounded-full shadow-md transition-all transform ${analyzeBackMatter ? 'translate-x-5.5' : 'translate-x-0'}`}></div>
                    </button>
                 </div>
              </div>

              {isAnalyzing ? (
                <div className="space-y-8">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-44 bg-white dark:bg-gh-dark-sub border-2 border-gh-light-border/40 dark:border-gh-dark-border/40 rounded-3xl animate-pulse flex flex-col p-10 gap-6">
                      <div className="h-5 w-32 bg-manan-primary/20 rounded-full"></div>
                      <div className="h-5 w-full bg-gh-light-border dark:bg-gh-dark-border rounded-full"></div>
                      <div className="h-5 w-3/4 bg-gh-light-border dark:bg-gh-dark-border rounded-full"></div>
                    </div>
                  ))}
                  <p className="text-center text-gh-light-muted dark:text-gh-dark-muted animate-subtle font-black text-xs uppercase tracking-widest">Diving into the text...</p>
                </div>
              ) : currentChapterData?.nuggets.length === 0 ? (
                <div className="text-center py-32 bg-gh-light-sub dark:bg-gh-dark-sub border-4 border-dashed border-gh-light-border/40 dark:border-gh-dark-border/40 rounded-[3rem]">
                   <div className="mb-8 opacity-20">
                     <i className="fas fa-feather text-8xl"></i>
                   </div>
                   <p className="text-2xl font-black text-gh-light-muted dark:text-gh-dark-muted">No key insights detected here.</p>
                   {(currentChapterData?.isBackMatter || currentChapterData?.isFrontMatter) && (
                     <div className="mt-6">
                       <p className="text-xs font-black text-manan-dark dark:text-manan-accent bg-manan-primary/10 inline-block px-6 py-2 rounded-full border border-manan-primary/20 uppercase tracking-widest">Metadata Segment Bypassed</p>
                     </div>
                   )}
                </div>
              ) : (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="grid grid-cols-1 gap-8">
                    {currentChapterData?.nuggets.map((nugget) => {
                      const isSelected = notes.some(n => n.id === nugget.id);
                      return (
                        <div 
                          key={nugget.id}
                          onClick={() => toggleNote(nugget)}
                          className={`nugget-card cursor-pointer p-10 rounded-3xl border-2 transition-all relative group shadow-sm hover:shadow-xl ${
                            isSelected 
                              ? 'bg-manan-primary/5 dark:bg-manan-primary/10 border-manan-primary ring-4 ring-manan-primary/10' 
                              : 'bg-white dark:bg-gh-dark-sub border-gh-light-border dark:border-gh-dark-border hover:border-manan-primary'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-8">
                            <span className={`text-[10px] px-4 py-1.5 rounded-full border-2 font-black uppercase tracking-widest flex items-center gap-2 ${
                              nugget.type === NuggetType.QUOTE ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-900' :
                              nugget.type === NuggetType.LEARNING ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-900' :
                              'bg-manan-primary/10 text-manan-dark border-manan-primary/30 dark:bg-manan-primary/20 dark:text-manan-primary dark:border-manan-dark'
                            }`}>
                              <i className={`fas ${nugget.type === NuggetType.QUOTE ? 'fa-quote-left' : nugget.type === NuggetType.LEARNING ? 'fa-graduation-cap' : 'fa-lightbulb'} text-[8px]`}></i>
                              {nugget.type}
                            </span>
                            <div className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all ${
                              isSelected ? 'bg-manan-dark dark:bg-manan-primary border-manan-dark dark:border-manan-primary text-white dark:text-gh-dark-bg' : 'bg-gh-light-sub dark:bg-gh-dark-bg border-gh-light-border dark:border-gh-dark-border text-gh-light-muted dark:text-gh-dark-muted group-hover:border-manan-primary group-hover:text-manan-primary'
                            }`}>
                              <i className={`fas ${isSelected ? 'fa-check' : 'fa-plus'} text-sm`}></i>
                            </div>
                          </div>
                          
                          <p className={`text-gh-light-text dark:text-gh-dark-text leading-relaxed tracking-tight ${
                            nugget.type === NuggetType.QUOTE ? 'font-serif italic text-3xl mb-3' : 'text-xl font-semibold'
                          }`}>
                            {nugget.content}
                          </p>

                          <div className="mt-8 flex items-center justify-between pt-6 border-t border-gh-light-border/40 dark:border-gh-dark-border/40">
                             <div className="flex items-center gap-2">
                               <span className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest">{nugget.locationLabel}</span>
                             </div>
                             {nugget.source && <span className="text-[10px] text-manan-dark dark:text-manan-primary font-black max-w-[300px] truncate bg-manan-primary/10 px-3 py-1 rounded-lg italic border border-manan-primary/10">{nugget.source}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-center gap-8 py-16">
                    <button 
                      onClick={() => {
                        setCurrentChapterIndex(i => Math.max(0, i - 1));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={currentChapterIndex === 0 || isAnalyzing}
                      className="px-10 py-4 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center gap-3 hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 font-black text-sm transition-all shadow-md active:scale-95 group"
                    >
                      <i className="fas fa-chevron-left group-hover:-translate-x-1 transition-transform"></i> Previous Segment
                    </button>
                    <button 
                      onClick={() => {
                        setCurrentChapterIndex(i => Math.min(book.chapters.length - 1, i + 1));
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                      disabled={currentChapterIndex === book.chapters.length - 1 || isAnalyzing}
                      className="px-10 py-4 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center gap-3 hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 font-black text-sm transition-all shadow-md active:scale-95 group"
                    >
                      Next Segment <i className="fas fa-chevron-right group-hover:translate-x-1 transition-transform"></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {book && (
          <aside className="hidden lg:flex w-[420px] flex-col border-l border-gh-light-border dark:border-gh-dark-border bg-gh-light-sub dark:bg-gh-dark-sub shadow-2xl relative z-40">
            <div className="p-10 border-b border-gh-light-border dark:border-gh-dark-border flex justify-between items-center bg-white dark:bg-gh-dark-sub shadow-sm">
              <h3 className="font-black flex flex-col gap-1 text-sm uppercase tracking-[0.2em] text-manan-dark dark:text-manan-primary">
                <div className="flex items-center gap-2">
                  <i className="fas fa-folder-tree text-manan-primary"></i>
                  <span>DISTILLED</span>
                </div>
                <div className="text-[9px] text-gh-light-muted dark:text-gh-dark-muted">{notes.length} NUGGETS COLLECTED</div>
              </h3>
              {notes.length > 0 && (
                <button 
                  onClick={downloadNotes}
                  className="bg-[#1f883d] text-white px-6 py-3 rounded-xl text-xs font-black hover:bg-[#166534] transition-all shadow-lg active:scale-95 flex items-center gap-2"
                >
                  <i className="fas fa-download"></i> EXPORT
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
              {notes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-gh-light-muted dark:text-gh-dark-muted opacity-30 px-10">
                  <div className="mb-10 w-24 h-24 bg-gh-light-border dark:bg-gh-dark-border rounded-full flex items-center justify-center">
                    <i className="fas fa-layer-group text-4xl"></i>
                  </div>
                  <p className="text-sm font-black leading-relaxed uppercase tracking-widest">Select cards to build your markdown summary.</p>
                </div>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="relative group border-l-4 border-manan-primary bg-white dark:bg-gh-dark-bg p-6 rounded-r-2xl transition-all shadow-sm hover:shadow-lg border border-gh-light-border/30 dark:border-gh-dark-border/30">
                    <button 
                      onClick={() => toggleNote({ id: note.id, content: note.content, type: note.type, sortIndex: note.sortIndex })}
                      className="absolute -right-3 -top-3 opacity-0 group-hover:opacity-100 bg-red-500 text-white w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-90"
                      title="Discard"
                    >
                      <i className="fas fa-trash-can text-xs"></i>
                    </button>
                    <div className="flex items-center gap-3 text-[9px] text-manan-dark dark:text-manan-accent font-black uppercase tracking-widest mb-3">
                      <span className="truncate max-w-[180px]">{note.chapterTitle}</span>
                      <span className="opacity-20">/</span>
                      <span>{note.locationLabel}</span>
                    </div>
                    <p className={`text-sm text-gh-light-text dark:text-gh-dark-text line-clamp-5 leading-relaxed font-medium ${note.type === NuggetType.QUOTE ? 'italic font-serif' : ''}`}>
                      {note.content}
                    </p>
                  </div>
                ))
              )}
            </div>

            <div className="p-10 bg-white dark:bg-gh-dark-bg border-t border-gh-light-border dark:border-gh-dark-border shadow-inner">
               <div className="flex items-center justify-between text-[10px] text-gh-light-muted dark:text-gh-dark-muted mb-4 font-black uppercase tracking-[0.2em]">
                 <span>OVERALL READING</span>
                 <span className="font-mono bg-manan-primary/10 text-manan-dark dark:text-manan-primary px-3 py-1 rounded-lg border border-manan-primary/10">{Math.round(((currentChapterIndex + 1) / book.chapters.length) * 100)}%</span>
               </div>
               <div className="h-4 w-full bg-gh-light-border/30 dark:bg-gh-dark-border/30 rounded-full overflow-hidden shadow-inner p-1">
                 <div className="h-full bg-gradient-to-r from-manan-dark to-manan-primary transition-all duration-1000 shadow-sm rounded-full" style={{ width: `${((currentChapterIndex + 1) / book.chapters.length) * 100}%` }}></div>
               </div>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
};

export default App;
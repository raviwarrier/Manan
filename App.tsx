
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
  const [analyzeBoilerplate, setAnalyzeBoilerplate] = useState(false);
  const [selectedNuggetTypes, setSelectedNuggetTypes] = useState<NuggetType[]>([
    NuggetType.QUOTE, NuggetType.LEARNING, NuggetType.INSIGHT
  ]);
  const [editingTagsFor, setEditingTagsFor] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [isNavOpen, setIsNavOpen] = useState(true);

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
        analyzeBoilerplate,
        selectedNuggetTypes
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
  }, [book, analyzeBackMatter, analyzeBoilerplate, selectedNuggetTypes]);

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
        analyzeBoilerplate,
        selectedNuggetTypes
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
  }, [book, prefetchNext, analyzeBackMatter, analyzeBoilerplate, selectedNuggetTypes]);

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
        locationLabel: nugget.locationLabel,
        tags: nugget.tags || [],
        source: nugget.source
      };
      const newNotes = [...notes, newNote].sort((a, b) => {
        if (a.chapterIndex !== b.chapterIndex) return a.chapterIndex - b.chapterIndex;
        return a.sortIndex - b.sortIndex;
      });
      setNotes(newNotes);
    }
  };

  const updateNuggetTags = (nuggetId: string, tags: string[]) => {
    if (currentChapterData) {
      const updatedNuggets = currentChapterData.nuggets.map(n => 
        n.id === nuggetId ? { ...n, tags } : n
      );
      setCurrentChapterData({ ...currentChapterData, nuggets: updatedNuggets });
    }
    setNotes(notes.map(n => n.id === nuggetId ? { ...n, tags } : n));
  };

  const handleAddTag = (nuggetId: string) => {
    if (!tagInput.trim()) return;
    const cleanTag = tagInput.trim().replace(/^#/, '');
    const nugget = currentChapterData?.nuggets.find(n => n.id === nuggetId) || notes.find(n => n.id === nuggetId);
    if (nugget) {
      const currentTags = nugget.tags || [];
      if (!currentTags.includes(cleanTag)) {
        updateNuggetTags(nuggetId, [...currentTags, cleanTag]);
      }
    }
    setTagInput('');
  };

  const removeTag = (nuggetId: string, tagToRemove: string) => {
    const nugget = currentChapterData?.nuggets.find(n => n.id === nuggetId) || notes.find(n => n.id === nuggetId);
    if (nugget) {
      const currentTags = nugget.tags || [];
      updateNuggetTags(nuggetId, currentTags.filter(t => t !== tagToRemove));
    }
  };

  const toggleNuggetTypePreference = (type: NuggetType) => {
    const next = selectedNuggetTypes.includes(type) 
      ? selectedNuggetTypes.filter(t => t !== type)
      : [...selectedNuggetTypes, type];
    setSelectedNuggetTypes(next);
    cachedChapters.current.clear();
    analyzeChapter(currentChapterIndex);
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
        const tags = item.tags && item.tags.length > 0 ? ` ${item.tags.map(t => `#${t}`).join(' ')}` : '';
        const source = item.source ? ` — ${item.source}` : '';
        
        if (item.type === NuggetType.QUOTE) markdown += `> ${item.content}${source}${loc}${tags}\n\n`;
        else if (item.type === NuggetType.LEARNING) markdown += `* **Key Learning:** ${item.content}${source}${loc}${tags}\n\n`;
        else markdown += `* ${item.content}${source}${loc}${tags}\n\n`;
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

  const jumpToChapter = (index: number) => {
    setCurrentChapterIndex(index);
    // Smooth scroll only the content area if possible, but window is fine for now
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const progressPercent = book ? Math.round(((currentChapterIndex + 1) / book.chapters.length) * 100) : 0;

  return (
    <div className="min-h-screen bg-gh-light-bg dark:bg-gh-dark-bg text-gh-light-text dark:text-gh-dark-text flex flex-col font-sans transition-colors duration-300">
      {/* Main Header */}
      <header className="bg-white dark:bg-gh-dark-sub border-b border-gh-light-border dark:border-gh-dark-border px-6 py-3 flex items-center justify-between gap-4 z-[60] shadow-sm relative">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsNavOpen(!isNavOpen)}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all active:scale-90 ${isNavOpen ? 'text-manan-dark dark:text-manan-primary bg-manan-primary/10' : 'text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-primary'}`}
            title="Toggle Navigation"
          >
            <i className={`fas ${isNavOpen ? 'fa-indent' : 'fa-outdent'} text-lg`}></i>
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 overflow-hidden rounded-lg bg-white border-2 border-manan-primary dark:border-manan-dark flex items-center justify-center shadow-sm">
              <img 
                src="images/logo.png" 
                alt="Manan Logo" 
                className="w-full h-full object-contain p-1"
                onError={(e) => {
                  const target = e.target as HTMLImageElement;
                  target.src = 'https://img.icons8.com/color/96/blue-footed-booby.png';
                }}
              />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-black tracking-tighter text-manan-dark dark:text-manan-primary leading-none">Manan</h1>
              {book && <p className="text-[8px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest truncate max-w-[150px] mt-0.5">{book.title}</p>}
            </div>
          </div>
        </div>

        {book && (
          <form 
            onSubmit={handleSearch}
            className="hidden md:flex flex-1 max-w-md relative group"
          >
            <input 
              type="text"
              placeholder="Context search..."
              className="w-full bg-gh-light-sub dark:bg-gh-dark-bg border border-gh-light-border dark:border-gh-dark-border rounded-xl pl-5 pr-12 py-2 text-sm focus:ring-4 ring-manan-primary/20 outline-none transition-all placeholder-gh-light-muted dark:placeholder-gh-dark-muted shadow-inner"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button 
              type="submit"
              disabled={isSearching}
              className="absolute right-1 top-1 w-8 h-8 rounded-lg bg-manan-primary/10 text-manan-dark dark:text-manan-primary flex items-center justify-center hover:bg-manan-primary hover:text-white transition-all disabled:opacity-50"
            >
              <i className={`fas ${isSearching ? 'fa-circle-notch fa-spin' : 'fa-magnifying-glass'} text-xs`}></i>
            </button>
          </form>
        )}

        <div className="flex items-center gap-4">
          <div className="text-right hidden xl:block mr-2">
            <p className="text-[9px] text-gh-light-muted dark:text-gh-dark-muted uppercase font-black leading-none mb-1">Session</p>
            <p className="text-xs font-mono text-emerald-600 dark:text-emerald-400 font-black">${stats.estimatedCost.toFixed(5)}</p>
          </div>
          <button 
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-gh-light-sub dark:bg-gh-dark-sub text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-primary border border-gh-light-border dark:border-gh-dark-border transition-all"
          >
            <i className={`fas ${theme === 'light' ? 'fa-moon' : 'fa-sun'} text-base`}></i>
          </button>
          {book && (
            <button 
              onClick={reset} 
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-50 dark:bg-red-900/10 text-red-500 hover:bg-red-500 hover:text-white border border-red-200 dark:border-red-900/30 transition-all" 
              title="Close Book"
            >
              <i className="fas fa-xmark text-base"></i>
            </button>
          )}
        </div>
      </header>

      {/* Sticky Sub-Header Panel */}
      {book && (
        <div className="sticky top-0 z-50 bg-white/80 dark:bg-gh-dark-sub/80 backdrop-blur-lg border-b border-gh-light-border dark:border-gh-dark-border shadow-sm px-6 py-2 transition-all">
          <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            {/* Progress Segment */}
            <div className="flex items-center gap-6 flex-1 w-full md:w-auto">
              <div className="flex flex-col gap-1 flex-1">
                <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-widest text-gh-light-muted dark:text-gh-dark-muted">
                  <span className="flex items-center gap-2">
                    <i className="fas fa-bookmark text-manan-primary"></i>
                    {currentChapterData?.title || 'Segment Analysis'}
                  </span>
                  <span>{progressPercent}% Complete</span>
                </div>
                <div className="h-2 w-full bg-gh-light-border/30 dark:bg-gh-dark-border/30 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-manan-primary transition-all duration-700 ease-out shadow-[0_0_8px_rgba(79,195,247,0.5)]" 
                    style={{ width: `${progressPercent}%` }}
                  ></div>
                </div>
              </div>
            </div>

            {/* Navigation Segment */}
            <div className="flex items-center gap-4 shrink-0">
               <div className="flex items-center gap-1 bg-gh-light-sub dark:bg-gh-dark-bg p-1 rounded-xl border border-gh-light-border dark:border-gh-dark-border">
                  <button 
                    onClick={() => jumpToChapter(Math.max(0, currentChapterIndex - 1))}
                    disabled={currentChapterIndex === 0 || isAnalyzing}
                    className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-manan-primary/10 text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-dark dark:hover:text-manan-primary disabled:opacity-20 transition-all"
                  >
                    <i className="fas fa-chevron-left text-sm"></i>
                  </button>
                  <div className="px-3 flex items-center gap-2">
                    <input 
                      type="range" 
                      min="0" 
                      max={book.chapters.length - 1} 
                      value={currentChapterIndex} 
                      onChange={(e) => jumpToChapter(parseInt(e.target.value))}
                      className="w-24 md:w-40 cursor-pointer h-1 rounded-full appearance-none bg-gh-light-border dark:bg-gh-dark-border"
                      style={{ accentColor: '#4fc3f7' }}
                    />
                    <span className="text-[10px] font-mono font-black min-w-[50px] text-center bg-manan-primary/5 dark:bg-manan-primary/10 py-1 rounded-md">
                      {currentChapterIndex + 1} / {book.chapters.length}
                    </span>
                  </div>
                  <button 
                    onClick={() => jumpToChapter(Math.min(book.chapters.length - 1, currentChapterIndex + 1))}
                    disabled={currentChapterIndex === book.chapters.length - 1 || isAnalyzing}
                    className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-manan-primary/10 text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-dark dark:hover:text-manan-primary disabled:opacity-20 transition-all"
                  >
                    <i className="fas fa-chevron-right text-sm"></i>
                  </button>
               </div>
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 flex overflow-hidden h-[calc(100vh-100px)]">
        {/* Navigation Sidebar */}
        <nav 
          className={`border-r border-gh-light-border dark:border-gh-dark-border bg-gh-light-sub dark:bg-gh-dark-sub flex flex-col overflow-hidden transition-all duration-300 ease-in-out ${
            isNavOpen && book ? 'w-64 opacity-100' : 'w-0 opacity-0'
          }`}
        >
          {book ? (
            <>
              <div className="p-6 border-b border-gh-light-border dark:border-gh-dark-border bg-white dark:bg-gh-dark-sub">
                <h4 className="text-[10px] font-black uppercase tracking-[0.2em] text-gh-light-muted dark:text-gh-dark-muted mb-2">Book Map</h4>
                <p className="text-xs font-bold text-manan-dark dark:text-manan-primary truncate leading-tight" title={book.title}>{book.title}</p>
              </div>
              <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
                {book.chapterLocations.length > 0 ? (
                  book.chapterLocations.map((loc, idx) => {
                    const isActive = currentChapterIndex === idx;
                    const cachedData = cachedChapters.current.get(idx);
                    return (
                      <button
                        key={idx}
                        onClick={() => jumpToChapter(idx)}
                        className={`w-full text-left px-4 py-3 rounded-xl transition-all flex flex-col gap-1 group ${
                          isActive 
                            ? 'bg-manan-primary/10 border-l-4 border-manan-primary text-manan-dark dark:text-manan-primary shadow-sm' 
                            : 'hover:bg-gh-light-border/20 dark:hover:bg-gh-dark-border/20'
                        }`}
                      >
                        <span className={`text-[9px] font-black uppercase tracking-widest ${isActive ? 'text-manan-dark dark:text-manan-primary' : 'text-gh-light-muted dark:text-gh-dark-muted'}`}>
                          {loc}
                        </span>
                        <span className={`text-xs font-semibold truncate ${isActive ? 'opacity-100' : 'opacity-60 group-hover:opacity-100'}`}>
                          {cachedData?.title || (idx === 0 ? "Initial Segment" : `Section ${idx + 1}`)}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="p-6 text-center text-gh-light-muted dark:text-gh-dark-muted italic text-xs">
                    No segments detected in this file.
                  </div>
                )}
              </div>
            </>
          ) : null}
        </nav>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-8 scroll-smooth custom-scrollbar">
          {!book ? (
            <div className="max-w-2xl mx-auto mt-20 text-center animate-in fade-in duration-700">
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
               <h2 className="text-5xl font-black mb-6 tracking-tighter text-manan-dark dark:text-manan-primary">Reflect. Distill. Remember.</h2>
               <p className="text-gh-light-muted dark:text-gh-dark-muted mb-12 text-2xl font-medium leading-relaxed max-w-lg mx-auto">
                 Deep-scan your books for quotes, insights, and key lessons with AI precision.
               </p>
               
               <div className="flex flex-col items-center gap-8 mb-12">
                  <div className="flex items-center gap-4 bg-gh-light-sub dark:bg-gh-dark-sub p-4 rounded-2xl border border-gh-light-border dark:border-gh-dark-border shadow-inner">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gh-light-muted dark:text-gh-dark-muted px-2">Searching for:</span>
                    {[NuggetType.QUOTE, NuggetType.INSIGHT, NuggetType.LEARNING].map(type => (
                      <button 
                        key={type}
                        onClick={() => toggleNuggetTypePreference(type)}
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter transition-all border-2 ${
                          selectedNuggetTypes.includes(type) 
                          ? 'bg-manan-primary border-manan-primary text-white dark:text-gh-dark-bg shadow-md scale-105' 
                          : 'bg-white dark:bg-gh-dark-bg border-gh-light-border dark:border-gh-dark-border text-gh-light-muted dark:text-gh-dark-muted opacity-60'
                        }`}
                      >
                        {type}s
                      </button>
                    ))}
                  </div>

                  <label className="cursor-pointer inline-flex items-center group">
                    <input type="file" className="hidden" accept=".pdf,.epub" onChange={handleFileUpload} disabled={isProcessing} />
                    <div className={`px-14 py-5 bg-manan-dark dark:bg-manan-primary text-white dark:text-gh-dark-bg rounded-2xl font-black text-xl hover:scale-105 transition-all flex items-center gap-4 shadow-xl active:scale-95 ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}>
                      <i className={`fas ${isProcessing ? 'fa-spinner fa-spin' : 'fa-feather-pointed'}`}></i>
                      <span>{isProcessing ? 'Harvesting knowledge...' : 'Upload Book'}</span>
                    </div>
                  </label>
               </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto pb-32 space-y-10">
              {/* Context Filtering Controls (Secondary) */}
              <div className="flex flex-wrap items-center justify-between gap-6 bg-gh-light-sub/50 dark:bg-gh-dark-sub/50 p-4 rounded-2xl border border-gh-light-border/40 dark:border-gh-dark-border/40 shadow-sm">
                 <div className="flex items-center gap-4">
                    <span className="text-[10px] font-black uppercase tracking-widest text-gh-light-muted dark:text-gh-dark-muted px-2 border-r border-gh-light-border dark:border-gh-dark-border mr-2">Visible:</span>
                    {[NuggetType.QUOTE, NuggetType.INSIGHT, NuggetType.LEARNING].map(type => (
                      <button 
                        key={type}
                        onClick={() => toggleNuggetTypePreference(type)}
                        className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter transition-all ${
                          selectedNuggetTypes.includes(type) 
                          ? 'bg-manan-primary text-white dark:text-gh-dark-bg shadow-sm' 
                          : 'text-gh-light-muted dark:text-gh-dark-muted opacity-40 hover:opacity-100'
                        }`}
                      >
                        {type}s
                      </button>
                    ))}
                 </div>
                 <div className="flex items-center gap-8">
                   <div className="flex items-center gap-3 group cursor-help" title="Include Copyright, ToC, Acknowledgements, etc. (Skipped by default)">
                      <span className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest">Metadata</span>
                      <button 
                        onClick={() => {
                          setAnalyzeBoilerplate(!analyzeBoilerplate);
                          cachedChapters.current.clear();
                        }}
                        className={`w-11 h-6 rounded-full transition-all relative shadow-inner p-1 ${analyzeBoilerplate ? 'bg-manan-primary' : 'bg-gh-light-border dark:bg-gh-dark-border'}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all transform ${analyzeBoilerplate ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </button>
                   </div>
                   <div className="flex items-center gap-3 group cursor-help" title="Include Indexes, Appendices, etc.">
                      <span className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted font-black uppercase tracking-widest">Back-Matter</span>
                      <button 
                        onClick={() => {
                          setAnalyzeBackMatter(!analyzeBackMatter);
                          cachedChapters.current.clear();
                        }}
                        className={`w-11 h-6 rounded-full transition-all relative shadow-inner p-1 ${analyzeBackMatter ? 'bg-manan-primary' : 'bg-gh-light-border dark:bg-gh-dark-border'}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full shadow-md transition-all transform ${analyzeBackMatter ? 'translate-x-5' : 'translate-x-0'}`}></div>
                      </button>
                   </div>
                 </div>
              </div>

              {isAnalyzing ? (
                <div className="space-y-8 animate-in fade-in duration-500">
                  {[1,2,3].map(i => (
                    <div key={i} className="h-44 bg-white dark:bg-gh-dark-sub border-2 border-gh-light-border/40 dark:border-gh-dark-border/40 rounded-3xl animate-pulse flex flex-col p-10 gap-6">
                      <div className="h-5 w-32 bg-manan-primary/20 rounded-full"></div>
                      <div className="h-5 w-full bg-gh-light-border dark:bg-gh-dark-border rounded-full"></div>
                      <div className="h-5 w-3/4 bg-gh-light-border dark:bg-gh-dark-border rounded-full"></div>
                    </div>
                  ))}
                  <p className="text-center text-gh-light-muted dark:text-gh-dark-muted animate-subtle font-black text-xs uppercase tracking-[0.2em]">Deep scanning context...</p>
                </div>
              ) : currentChapterData?.nuggets.length === 0 ? (
                <div className="text-center py-32 bg-gh-light-sub dark:bg-gh-dark-sub border-4 border-dashed border-gh-light-border/40 dark:border-gh-dark-border/40 rounded-[3rem] animate-in zoom-in-95 duration-500">
                   <div className="mb-8 opacity-20">
                     <i className="fas fa-feather-pointed text-8xl"></i>
                   </div>
                   <p className="text-2xl font-black text-gh-light-muted dark:text-gh-dark-muted">Quiet segment. No core insights found.</p>
                   {(currentChapterData?.isBackMatter || currentChapterData?.isFrontMatter) && (
                     <div className="mt-6">
                       <p className="text-xs font-black text-manan-dark dark:text-manan-accent bg-manan-primary/10 inline-block px-6 py-2 rounded-full border border-manan-primary/20 uppercase tracking-widest">Segment Filtered (Non-content)</p>
                     </div>
                   )}
                </div>
              ) : (
                <div className="space-y-8 animate-in slide-in-from-bottom-6 fade-in duration-700">
                  {currentChapterData?.nuggets.map((nugget) => {
                    const isSelected = notes.some(n => n.id === nugget.id);
                    const isEditingTags = editingTagsFor === nugget.id;

                    return (
                      <div 
                        key={nugget.id}
                        className={`nugget-card p-10 rounded-3xl border-2 transition-all relative group shadow-sm hover:shadow-xl ${
                          isSelected 
                            ? 'bg-manan-primary/5 dark:bg-manan-primary/10 border-manan-primary ring-4 ring-manan-primary/10' 
                            : 'bg-white dark:bg-gh-dark-sub border-gh-light-border dark:border-gh-dark-border hover:border-manan-primary/50'
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
                          
                          <div className="flex items-center gap-3">
                              <button 
                                onClick={() => setEditingTagsFor(isEditingTags ? null : nugget.id)}
                                className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all ${
                                  isEditingTags ? 'bg-manan-primary text-white border-manan-primary' : 'bg-gh-light-sub dark:bg-gh-dark-bg text-gh-light-muted dark:text-gh-dark-muted hover:text-manan-primary border-gh-light-border dark:border-gh-dark-border shadow-sm'
                                }`}
                                title="Add/Edit Tags"
                              >
                                <i className="fas fa-hashtag text-sm"></i>
                              </button>
                              <button 
                                onClick={() => toggleNote(nugget)}
                                className={`w-10 h-10 rounded-xl flex items-center justify-center border-2 transition-all shadow-sm ${
                                  isSelected ? 'bg-manan-dark dark:bg-manan-primary border-manan-dark dark:border-manan-primary text-white dark:text-gh-dark-bg' : 'bg-gh-light-sub dark:bg-gh-dark-bg border-gh-light-border dark:border-gh-dark-border text-gh-light-muted dark:text-gh-dark-muted group-hover:border-manan-primary group-hover:text-manan-primary'
                                }`}
                                title={isSelected ? "Remove from collection" : "Add to collection"}
                              >
                                <i className={`fas ${isSelected ? 'fa-check' : 'fa-plus'} text-sm`}></i>
                              </button>
                          </div>
                        </div>
                        
                        <p className={`text-gh-light-text dark:text-gh-dark-text leading-relaxed tracking-tight ${
                          nugget.type === NuggetType.QUOTE ? 'font-serif italic text-3xl mb-3' : 'text-xl font-semibold'
                        }`}>
                          {nugget.content}
                        </p>
                        
                        {nugget.source && (
                          <div className="mt-4 text-sm text-gh-light-muted dark:text-gh-dark-muted italic border-l-2 border-manan-primary/30 pl-4 py-1.5 bg-manan-primary/5 dark:bg-manan-primary/10 rounded-r-lg">
                            — {nugget.source}
                          </div>
                        )}

                        {(isEditingTags || (nugget.tags && nugget.tags.length > 0)) && (
                          <div className="mt-6 flex flex-wrap gap-2 items-center bg-gh-light-sub dark:bg-gh-dark-bg/50 p-4 rounded-2xl border border-gh-light-border/50 dark:border-gh-dark-border/50 shadow-inner">
                             {nugget.tags?.map(tag => (
                               <span key={tag} className="bg-manan-primary/20 text-manan-dark dark:text-manan-primary px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-tighter flex items-center gap-2 group/tag">
                                 #{tag}
                                 <button onClick={() => removeTag(nugget.id, tag)} className="hover:text-red-500 transition-colors"><i className="fas fa-times"></i></button>
                               </span>
                             ))}
                             {isEditingTags && (
                               <div className="flex items-center gap-2">
                                  <input 
                                    type="text"
                                    autoFocus
                                    placeholder="Add tag..."
                                    className="bg-transparent border-b-2 border-manan-primary outline-none text-xs px-2 py-1 w-32 md:w-40"
                                    value={tagInput}
                                    onChange={(e) => setTagInput(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleAddTag(nugget.id);
                                      if (e.key === 'Escape') setEditingTagsFor(null);
                                    }}
                                  />
                                  <button onClick={() => handleAddTag(nugget.id)} className="text-manan-primary hover:scale-110 transition-transform active:scale-90"><i className="fas fa-plus-circle"></i></button>
                               </div>
                             )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  
                  {/* Bottom Nav Helper */}
                  <div className="flex items-center justify-center gap-8 py-20">
                    <button 
                      onClick={() => jumpToChapter(Math.max(0, currentChapterIndex - 1))}
                      disabled={currentChapterIndex === 0 || isAnalyzing}
                      className="px-8 py-4 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center gap-3 hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 font-black text-sm transition-all shadow-md active:scale-95 group"
                    >
                      <i className="fas fa-chevron-left group-hover:-translate-x-1 transition-transform"></i> Previous Segment
                    </button>
                    <button 
                      onClick={() => jumpToChapter(Math.min(book.chapters.length - 1, currentChapterIndex + 1))}
                      disabled={currentChapterIndex === book.chapters.length - 1 || isAnalyzing}
                      className="px-8 py-4 rounded-2xl border-2 border-gh-light-border dark:border-gh-dark-border flex items-center gap-3 hover:bg-manan-primary/10 dark:hover:bg-manan-primary/10 disabled:opacity-20 font-black text-sm transition-all shadow-md active:scale-95 group"
                    >
                      Next Segment <i className="fas fa-chevron-right group-hover:translate-x-1 transition-transform"></i>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Distilled Sidebar (Collection) */}
        {book && (
          <aside className="hidden lg:flex w-[400px] flex-col border-l border-gh-light-border dark:border-gh-dark-border bg-gh-light-sub dark:bg-gh-dark-sub shadow-2xl relative z-40 transition-all">
            <div className="p-8 border-b border-gh-light-border dark:border-gh-dark-border flex justify-between items-center bg-white dark:bg-gh-dark-sub shadow-sm">
              <h3 className="font-black flex flex-col gap-1 text-[11px] uppercase tracking-[0.2em] text-manan-dark dark:text-manan-primary">
                <div className="flex items-center gap-2">
                  <i className="fas fa-folder-tree text-manan-primary"></i>
                  <span>COLLECTION</span>
                </div>
                <div className="text-[9px] text-gh-light-muted dark:text-gh-dark-muted font-mono">{notes.length} ITEMS</div>
              </h3>
              {notes.length > 0 && (
                <button 
                  onClick={downloadNotes}
                  className="bg-manan-dark dark:bg-manan-primary text-white dark:text-gh-dark-bg px-5 py-2.5 rounded-xl text-[10px] font-black hover:scale-105 transition-all shadow-lg active:scale-95 flex items-center gap-2"
                >
                  <i className="fas fa-cloud-arrow-down"></i> EXPORT .MD
                </button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
              {notes.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center text-gh-light-muted dark:text-gh-dark-muted opacity-25 px-8">
                  <div className="mb-8 w-20 h-20 bg-gh-light-border dark:bg-gh-dark-border rounded-full flex items-center justify-center">
                    <i className="fas fa-feather text-3xl"></i>
                  </div>
                  <p className="text-[10px] font-black leading-relaxed uppercase tracking-[0.2em]">Select cards from the main view to build your final notes.</p>
                </div>
              ) : (
                notes.map((note) => (
                  <div key={note.id} className="relative group border-l-4 border-manan-primary bg-white dark:bg-gh-dark-bg p-5 rounded-r-2xl transition-all shadow-sm hover:shadow-lg border border-gh-light-border/30 dark:border-gh-dark-border/30 animate-in slide-in-from-right-4 duration-300">
                    <button 
                      onClick={() => toggleNote({ id: note.id, content: note.content, type: note.type, sortIndex: note.sortIndex })}
                      className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 bg-red-500 text-white w-7 h-7 rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110 active:scale-90"
                      title="Remove"
                    >
                      <i className="fas fa-times text-xs"></i>
                    </button>
                    <div className="flex items-center gap-2 text-[8px] text-manan-dark dark:text-manan-accent font-black uppercase tracking-widest mb-2 border-b border-gh-light-border/20 dark:border-gh-dark-border/20 pb-1">
                      <span className="truncate max-w-[120px]">{note.chapterTitle}</span>
                      <span className="opacity-20">•</span>
                      <span>{note.locationLabel}</span>
                    </div>
                    <p className={`text-xs text-gh-light-text dark:text-gh-dark-text line-clamp-4 leading-relaxed font-medium ${note.type === NuggetType.QUOTE ? 'italic font-serif' : ''}`}>
                      {note.content}
                    </p>
                    {note.source && (
                      <p className="text-[9px] text-gh-light-muted dark:text-gh-dark-muted italic mt-2 truncate border-t border-gh-light-border/10 pt-1">
                        — {note.source}
                      </p>
                    )}
                    {note.tags && note.tags.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {note.tags.map(tag => (
                          <span key={tag} className="text-[8px] font-black text-manan-dark dark:text-manan-primary bg-manan-primary/10 px-1.5 py-0.5 rounded-md border border-manan-primary/20">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="p-8 bg-gh-light-sub dark:bg-gh-dark-bg border-t border-gh-light-border dark:border-gh-dark-border flex flex-col gap-3">
               <div className="flex justify-between items-center">
                 <span className="text-[9px] font-black text-gh-light-muted dark:text-gh-dark-muted uppercase tracking-widest">Storage Status</span>
                 <span className="text-[9px] font-black text-manan-dark dark:text-manan-primary uppercase bg-manan-primary/10 px-2 py-0.5 rounded">Local Session</span>
               </div>
               <p className="text-[10px] text-gh-light-muted dark:text-gh-dark-muted leading-tight opacity-60">
                 Notes are saved locally in your browser. Clearing your cache or clicking "Close Book" will end the current session.
               </p>
            </div>
          </aside>
        )}
      </main>
    </div>
  );
};

export default App;

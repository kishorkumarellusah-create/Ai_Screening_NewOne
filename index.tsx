import React, { useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

// Initialize Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

interface RepoData {
  id: number;
  name: string;
  full_name: string;
  description: string;
  stargazers_count: number;
  forks_count: number;
  language: string;
  html_url: string;
  owner: {
    login: string;
    avatar_url: string;
  };
  updated_at: string;
}

interface EntryPoint {
  file: string;
  description: string;
}

interface Analysis {
  summary: string;
  techStack: string[];
  useCases: string[];
  recommendations: string;
  entryPoints: EntryPoint[];
  architecture: string;
}

const App: React.FC = () => {
  const [syncedRepos, setSyncedRepos] = useState<RepoData[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<RepoData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  // Load synced repos from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('synced_repos');
    if (saved) {
      try {
        setSyncedRepos(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to parse saved repos", e);
      }
    }
  }, []);

  // Save to localStorage
  useEffect(() => {
    localStorage.setItem('synced_repos', JSON.stringify(syncedRepos));
  }, [syncedRepos]);

  const fetchRepo = async (fullName: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`https://api.github.com/repos/${fullName}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error('Repository not found. Ensure it is public.');
        throw new Error('GitHub API error. Please try again later.');
      }
      const data: RepoData = await response.json();
      
      if (!syncedRepos.find(r => r.id === data.id)) {
        setSyncedRepos(prev => [data, ...prev]);
      }
      setSelectedRepo(data);
      setSearchQuery('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const removeRepo = (id: number) => {
    setSyncedRepos(prev => prev.filter(r => r.id !== id));
    if (selectedRepo?.id === id) {
      setSelectedRepo(null);
      setAnalysis(null);
    }
  };

  const analyzeRepo = async (repo: RepoData) => {
    setAnalyzing(true);
    setAnalysis(null);
    try {
      // Fetch README and file list if possible to identify starting points
      let readme = "No README found.";
      let fileList = "No file list found.";
      
      try {
        const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, {
          headers: { 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (readmeRes.ok) readme = await readmeRes.text();
        
        const treeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/`);
        if (treeRes.ok) {
          const contents = await treeRes.json();
          fileList = contents.map((c: any) => c.name).join(', ');
        }
      } catch (e) {}

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Analyze the following GitHub repository information and provide a detailed structured insight, focusing specifically on how a new developer should start with the project.
        
        Repository: ${repo.full_name}
        Description: ${repo.description}
        Primary Language: ${repo.language}
        Root Files: ${fileList}
        README Sample: ${readme.substring(0, 3000)}

        Return your response as a JSON object with the following structure:
        {
          "summary": "Concise summary of project purpose.",
          "techStack": ["List of core technologies"],
          "useCases": ["Case 1", "Case 2"],
          "recommendations": "Suggestion to improve the project.",
          "architecture": "High-level overview of the code structure (e.g. monolithic, microservices, MVC).",
          "entryPoints": [
            { "file": "path/to/main/entry", "description": "Why this is the starting point (e.g. main loop, server initialization, router)." },
            { "file": "path/to/config", "description": "Where settings live." }
          ]
        }
      `;

      const result = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json'
        }
      });

      const parsed = JSON.parse(result.text || '{}');
      setAnalysis(parsed);
    } catch (err) {
      console.error("Analysis failed", err);
      setError("AI analysis failed to identify entry points. Please try again.");
    } finally {
      setAnalyzing(false);
    }
  };

  useEffect(() => {
    if (selectedRepo) {
      analyzeRepo(selectedRepo);
    }
  }, [selectedRepo?.id]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-80 glass flex flex-col border-r border-gray-800">
        <div className="p-6 border-b border-gray-800 flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold">G</div>
          <h1 className="text-xl font-bold tracking-tight text-white">GitSync <span className="text-blue-500">AI</span></h1>
        </div>

        <div className="p-4">
          <div className="relative">
            <input
              type="text"
              placeholder="owner/repo (e.g. facebook/react)"
              className={`w-full bg-[#0d1117] border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all ${error ? 'border-red-500' : 'border-gray-700'}`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchQuery && fetchRepo(searchQuery)}
            />
            <button 
              disabled={loading}
              onClick={() => searchQuery && fetchRepo(searchQuery)}
              className="absolute right-2 top-1.5 text-gray-400 hover:text-white disabled:opacity-50"
            >
              {loading ? <div className="w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div> : <i data-lucide="plus-circle" className="w-5 h-5"></i>}
            </button>
          </div>
          {error && <p className="text-red-400 text-[10px] mt-2 px-1 font-medium italic">{error}</p>}
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">Synced Repositories</h2>
          {syncedRepos.length === 0 ? (
            <div className="p-3 text-gray-600 text-sm italic border border-dashed border-gray-800 rounded-lg">
              No repositories synced. Try "facebook/react" to start.
            </div>
          ) : (
            syncedRepos.map(repo => (
              <div
                key={repo.id}
                onClick={() => setSelectedRepo(repo)}
                className={`group flex items-center justify-between p-3 rounded-lg cursor-pointer transition-all ${
                  selectedRepo?.id === repo.id ? 'bg-blue-900/20 border border-blue-500/50' : 'hover:bg-gray-800/50 border border-transparent'
                }`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <img src={repo.owner.avatar_url} className="w-6 h-6 rounded-full" alt={repo.owner.login} />
                  <span className="text-sm font-medium truncate text-gray-200">{repo.full_name}</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); removeRepo(repo.id); }}
                  className="opacity-0 group-hover:opacity-100 text-gray-500 hover:text-red-400 transition-opacity"
                >
                  <i data-lucide="trash-2" className="w-4 h-4"></i>
                </button>
              </div>
            ))
          )}
        </nav>
        
        <div className="p-6 border-t border-gray-800 flex items-center justify-between">
          <span className="text-xs text-gray-500">Gemini 3 Pro Active</span>
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"></div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#0d1117] relative">
        {selectedRepo ? (
          <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
            {/* Header Section */}
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-4">
                <img src={selectedRepo.owner.avatar_url} className="w-16 h-16 rounded-xl border-2 border-gray-800 shadow-xl" alt={selectedRepo.owner.login} />
                <div>
                  <h1 className="text-3xl font-bold text-white mb-1">{selectedRepo.name}</h1>
                  <a href={selectedRepo.html_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1 text-sm">
                    {selectedRepo.full_name} <i data-lucide="external-link" className="w-3 h-3"></i>
                  </a>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-gray-800/50 border border-gray-700 px-4 py-2 rounded-lg text-center">
                  <div className="text-sm font-bold text-white">{selectedRepo.stargazers_count.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Stars</div>
                </div>
                <div className="bg-gray-800/50 border border-gray-700 px-4 py-2 rounded-lg text-center">
                  <div className="text-sm font-bold text-white">{selectedRepo.forks_count.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Forks</div>
                </div>
              </div>
            </div>

            {/* AI Analysis Section */}
            <div className="relative">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <i data-lucide="compass" className="text-blue-400 w-5 h-5"></i>
                Project Navigation & Architecture
              </h2>

              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin"></div>
                    <i data-lucide="search" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 w-8 h-8 animate-pulse"></i>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-medium text-white mb-2">Finding the Starting Point...</p>
                    <p className="text-gray-400 max-w-xs mx-auto">Gemini is crawling the file structure to identify project entry points and architectural patterns.</p>
                  </div>
                </div>
              ) : analysis ? (
                <div className="space-y-8">
                  {/* Summary & Arch Row */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2 glass p-6 rounded-xl border-l-4 border-l-blue-500">
                      <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-widest">Project Summary</h3>
                      <p className="text-gray-200 text-lg leading-relaxed">{analysis.summary}</p>
                    </div>
                    <div className="glass p-6 rounded-xl border-l-4 border-l-purple-500">
                      <h3 className="text-xs font-bold text-gray-500 uppercase mb-2 tracking-widest">Architecture</h3>
                      <p className="text-gray-200 font-medium">{analysis.architecture}</p>
                    </div>
                  </div>

                  {/* Entry Points Section - FIX FOR "Starting Point not created" */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2">
                      <i data-lucide="flag" className="w-4 h-4"></i>
                      Project Entry Points
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {analysis.entryPoints.map((entry, idx) => (
                        <div key={idx} className="bg-gray-800/40 border border-gray-700 p-4 rounded-xl hover:border-blue-500/50 transition-colors group">
                          <div className="flex items-start gap-3">
                            <i data-lucide="file-code" className="w-5 h-5 text-blue-400 mt-0.5"></i>
                            <div>
                              <div className="text-blue-400 font-mono text-sm font-bold mb-1 group-hover:underline cursor-pointer">{entry.file}</div>
                              <p className="text-xs text-gray-400 leading-normal">{entry.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Grid for Tech and Recommendations */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="glass p-6 rounded-xl">
                      <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                        <i data-lucide="layers" className="w-4 h-4"></i>
                        Core Tech Stack
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {analysis.techStack.map((tech, i) => (
                          <span key={i} className="px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full text-xs text-blue-300 font-medium">
                            {tech}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="glass p-6 rounded-xl">
                      <h3 className="text-sm font-bold text-gray-400 uppercase mb-4 tracking-widest flex items-center gap-2">
                        <i data-lucide="zap" className="w-4 h-4 text-orange-400"></i>
                        Quick Recommendation
                      </h3>
                      <p className="text-gray-300 text-sm italic leading-relaxed border-l-2 border-orange-500/30 pl-4">
                        {analysis.recommendations}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-gray-600">
                   <i data-lucide="alert-circle" className="w-12 h-12 mx-auto mb-4 opacity-20"></i>
                   <p>Unable to retrieve repository insights. Please check connectivity.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 max-w-4xl mx-auto">
            <div className="relative mb-8">
              <div className="w-24 h-24 bg-blue-600/20 rounded-3xl flex items-center justify-center shadow-2xl">
                <i data-lucide="github" className="w-12 h-12 text-blue-500"></i>
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center border-4 border-[#0d1117]">
                 <i data-lucide="wand-2" className="w-4 h-4 text-blue-400"></i>
              </div>
            </div>
            
            <h2 className="text-4xl font-black text-white mb-4 tracking-tight">Sync Your <span className="bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">Project Intelligence</span></h2>
            <p className="text-gray-400 text-center max-w-md text-lg mb-10 leading-relaxed">
              Connect with GitHub repositories to automatically discover entry points, architectural patterns, and specialized tech insights.
            </p>

            <div className="w-full max-w-2xl space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 glass rounded-2xl flex flex-col items-center text-center">
                   <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-blue-400 mb-2 font-bold text-xs">1</div>
                   <h4 className="text-white text-sm font-bold mb-1">Enter URL</h4>
                   <p className="text-[11px] text-gray-500">Type the owner/repo path in the search bar.</p>
                </div>
                <div className="p-4 glass rounded-2xl flex flex-col items-center text-center">
                   <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-blue-400 mb-2 font-bold text-xs">2</div>
                   <h4 className="text-white text-sm font-bold mb-1">AI Crawl</h4>
                   <p className="text-[11px] text-gray-500">Gemini identifies the starting point and architecture.</p>
                </div>
                <div className="p-4 glass rounded-2xl flex flex-col items-center text-center">
                   <div className="w-8 h-8 bg-gray-800 rounded-full flex items-center justify-center text-blue-400 mb-2 font-bold text-xs">3</div>
                   <h4 className="text-white text-sm font-bold mb-1">Deep Insight</h4>
                   <p className="text-[11px] text-gray-500">Get a roadmap for contributing or learning.</p>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest text-center">Try These Popular Starting Points</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div onClick={() => fetchRepo('facebook/react')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left flex items-center justify-between group">
                    <div>
                      <p className="text-[10px] text-blue-500 font-bold mb-0.5">Frontend Library</p>
                      <p className="font-bold text-white group-hover:text-blue-400 transition-colors">facebook/react</p>
                    </div>
                    <i data-lucide="chevron-right" className="w-4 h-4 text-gray-700 group-hover:text-blue-500"></i>
                  </div>
                  <div onClick={() => fetchRepo('shadcn-ui/ui')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left flex items-center justify-between group">
                    <div>
                      <p className="text-[10px] text-blue-500 font-bold mb-0.5">Component Library</p>
                      <p className="font-bold text-white group-hover:text-blue-400 transition-colors">shadcn-ui/ui</p>
                    </div>
                    <i data-lucide="chevron-right" className="w-4 h-4 text-gray-700 group-hover:text-blue-500"></i>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
      
      {/* Lucide Icon Refresh */}
      {useEffect(() => {
        // @ts-ignore
        if (window.lucide) {
          // @ts-ignore
          window.lucide.createIcons();
        }
      }, [selectedRepo, syncedRepos, loading, analyzing, analysis, error])}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
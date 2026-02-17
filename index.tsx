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
  isMain?: boolean;
}

interface Analysis {
  summary: string;
  techStack: string[];
  useCases: string[];
  recommendations: string;
  entryPoints: EntryPoint[];
  architecture: string;
  mainFilePath: string;
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
      let readme = "No README found.";
      let fileList = "No file list found.";
      let packageJson = "No package.json found.";
      
      try {
        // Fetch README
        const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, {
          headers: { 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (readmeRes.ok) readme = await readmeRes.text();
        
        // Fetch root file list
        const treeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/`);
        if (treeRes.ok) {
          const contents = await treeRes.json();
          fileList = contents.map((c: any) => `${c.type === 'dir' ? '[DIR] ' : ''}${c.name}`).join(', ');
        }

        // Specifically look for package.json or main config files to find the entry point
        const pkgRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/package.json`, {
          headers: { 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (pkgRes.ok) {
          packageJson = await pkgRes.text();
        }
      } catch (e) {
        console.warn("Supplementary file fetch failed", e);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Analyze the following GitHub repository information. Your goal is to identify the CRITICAL entry point (main file path) and project architecture.
        
        Repository: ${repo.full_name}
        Description: ${repo.description}
        Primary Language: ${repo.language}
        Root Files: ${fileList}
        package.json: ${packageJson.substring(0, 2000)}
        README Sample: ${readme.substring(0, 2000)}

        Return your response as a JSON object with the following structure:
        {
          "summary": "Concise summary of project purpose.",
          "techStack": ["List of core technologies"],
          "useCases": ["Case 1", "Case 2"],
          "recommendations": "Suggestion to improve the project.",
          "architecture": "High-level overview (e.g. Next.js App Router, Express API, Python CLI).",
          "mainFilePath": "The literal path to the primary execution file (e.g. src/index.ts, app/page.tsx, main.py).",
          "entryPoints": [
            { "file": "path/to/main/entry", "description": "Why this is the starting point.", "isMain": true },
            { "file": "path/to/config", "description": "Where settings live.", "isMain": false }
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
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white font-bold shadow-[0_0_15px_rgba(37,99,235,0.4)]">G</div>
          <h1 className="text-xl font-bold tracking-tight text-white">GitSync <span className="text-blue-500">AI</span></h1>
        </div>

        <div className="p-4">
          <div className="relative">
            <input
              type="text"
              placeholder="owner/repo (e.g. facebook/react)"
              className={`w-full bg-[#0d1117] border rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all placeholder:text-gray-600 ${error ? 'border-red-500' : 'border-gray-700'}`}
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
          <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse"></div>
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
                  <h1 className="text-3xl font-bold text-white mb-1 tracking-tight">{selectedRepo.name}</h1>
                  <a href={selectedRepo.html_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1 text-sm font-medium">
                    {selectedRepo.full_name} <i data-lucide="external-link" className="w-3 h-3"></i>
                  </a>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="bg-gray-800/50 border border-gray-700 px-4 py-2 rounded-lg text-center backdrop-blur-sm">
                  <div className="text-sm font-bold text-white">{selectedRepo.stargazers_count.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Stars</div>
                </div>
                <div className="bg-gray-800/50 border border-gray-700 px-4 py-2 rounded-lg text-center backdrop-blur-sm">
                  <div className="text-sm font-bold text-white">{selectedRepo.forks_count.toLocaleString()}</div>
                  <div className="text-[10px] text-gray-500 uppercase tracking-widest">Forks</div>
                </div>
              </div>
            </div>

            {/* AI Analysis Section */}
            <div className="relative">
              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin"></div>
                    <i data-lucide="search" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 w-8 h-8 animate-pulse"></i>
                  </div>
                  <div className="text-center">
                    <p className="text-xl font-medium text-white mb-2">Parsing Project Metadata...</p>
                    <p className="text-gray-400 max-w-xs mx-auto text-sm">Identifying main entry points, parsing package configurations, and mapping architectural patterns.</p>
                  </div>
                </div>
              ) : analysis ? (
                <div className="space-y-8 animate-in fade-in duration-500">
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

                  {/* Main Entry Point Highlight */}
                  <div className="bg-blue-600/10 border border-blue-500/30 p-6 rounded-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                      <i data-lucide="play-circle" className="w-24 h-24 text-blue-400"></i>
                    </div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="px-2 py-0.5 bg-blue-500 text-[10px] font-black uppercase tracking-tighter rounded text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]">Main File</span>
                        <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Primary Entry Point</h3>
                      </div>
                      <div className="flex items-baseline gap-3">
                        <code className="text-2xl font-mono text-white font-bold bg-black/40 px-3 py-1 rounded-lg border border-white/10">{analysis.mainFilePath || "Not detected"}</code>
                        <span className="text-gray-500 text-xs italic">Identified from file structure & package.json</span>
                      </div>
                    </div>
                  </div>

                  {/* Entry Points Section */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 px-1">
                      <i data-lucide="navigation" className="w-4 h-4"></i>
                      Navigational Map
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {analysis.entryPoints.map((entry, idx) => (
                        <div key={idx} className={`bg-gray-800/40 border p-4 rounded-xl hover:border-blue-500/50 transition-colors group ${entry.isMain ? 'border-blue-500/30' : 'border-gray-700'}`}>
                          <div className="flex items-start gap-3">
                            <div className={`p-2 rounded-lg ${entry.isMain ? 'bg-blue-500/10' : 'bg-gray-700/30'}`}>
                              <i data-lucide={entry.isMain ? "play" : "file-code"} className={`w-4 h-4 ${entry.isMain ? 'text-blue-400' : 'text-gray-400'}`}></i>
                            </div>
                            <div>
                              <div className="text-blue-400 font-mono text-sm font-bold mb-1 group-hover:underline cursor-pointer truncate max-w-[280px]">{entry.file}</div>
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
              <div className="w-24 h-24 bg-blue-600/10 rounded-3xl flex items-center justify-center shadow-2xl border border-blue-500/20">
                <i data-lucide="github" className="w-12 h-12 text-blue-500"></i>
              </div>
              <div className="absolute -bottom-2 -right-2 w-10 h-10 bg-gray-800 rounded-full flex items-center justify-center border-4 border-[#0d1117]">
                 <i data-lucide="wand-2" className="w-4 h-4 text-blue-400"></i>
              </div>
            </div>
            
            <h2 className="text-4xl font-black text-white mb-4 tracking-tight text-center">Sync Your <span className="bg-gradient-to-r from-blue-400 via-indigo-500 to-purple-500 bg-clip-text text-transparent">Project Intelligence</span></h2>
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
                      <p className="text-[10px] text-blue-500 font-bold mb-0.5 uppercase">Core Library</p>
                      <p className="font-bold text-white group-hover:text-blue-400 transition-colors">facebook/react</p>
                    </div>
                    <i data-lucide="chevron-right" className="w-4 h-4 text-gray-700 group-hover:text-blue-500"></i>
                  </div>
                  <div onClick={() => fetchRepo('shadcn-ui/ui')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left flex items-center justify-between group">
                    <div>
                      <p className="text-[10px] text-blue-500 font-bold mb-0.5 uppercase">Framework</p>
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
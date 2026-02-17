import React, { useState, useEffect } from 'react';
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
  default_branch: string;
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
  const [copied, setCopied] = useState(false);

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

  const fetchRepo = async (query: string) => {
    setLoading(true);
    setError(null);
    try {
      // Support owner/repo#branch syntax
      const [fullPath, branch] = query.split('#');
      const response = await fetch(`https://api.github.com/repos/${fullPath}`);
      if (!response.ok) {
        if (response.status === 404) throw new Error('Repository not found. Ensure it is public.');
        throw new Error('GitHub API error. Please try again later.');
      }
      const data: RepoData = await response.json();
      
      // Store branch info in a custom property if provided
      const finalData = branch ? { ...data, default_branch: branch } : data;

      if (!syncedRepos.find(r => r.id === data.id)) {
        setSyncedRepos(prev => [finalData, ...prev]);
      }
      setSelectedRepo(finalData);
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
      let configFiles: Record<string, string> = {};
      
      const branch = repo.default_branch || 'main';

      try {
        // Fetch README
        const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/README.md?ref=${branch}`);
        if (readmeRes.ok) {
          const content = await readmeRes.json();
          readme = atob(content.content);
        }
        
        // Fetch root file list (recursive)
        const treeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/git/trees/${branch}?recursive=1`);
        if (treeRes.ok) {
          const treeData = await treeRes.json();
          fileList = treeData.tree
            .filter((f: any) => f.type === 'blob')
            .map((f: any) => f.path)
            .join(', ');
        }

        // Fetch key config files to determine entry point
        const configsToTry = ['package.json', 'requirements.txt', 'pyproject.toml', 'app.py', 'streamlit_app.py', 'main.py'];
        await Promise.all(configsToTry.map(async (fileName) => {
          const res = await fetch(`https://api.github.com/repos/${repo.full_name}/contents/${fileName}?ref=${branch}`);
          if (res.ok) {
            const data = await res.json();
            configFiles[fileName] = atob(data.content).substring(0, 1000);
          }
        }));
      } catch (e) {
        console.warn("Supplementary file fetch failed", e);
      }

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Analyze this GitHub repository to find the MAIN ENTRY POINT (the file that should be run to start the app).
        
        Repository: ${repo.full_name}
        Description: ${repo.description}
        Primary Language: ${repo.language}
        Available Files (Sample): ${fileList.substring(0, 5000)}
        Config Summaries: ${JSON.stringify(configFiles)}
        README Snippet: ${readme.substring(0, 2000)}

        Rules:
        1. If it's a Streamlit app, look for files named 'streamlit_app.py' or 'app.py' containing streamlit imports.
        2. If it's a Node app, look at 'package.json' scripts or 'main' field.
        3. If it's Python, check for 'if __name__ == "__main__":' or 'main.py'.

        Return JSON:
        {
          "summary": "Short purpose.",
          "techStack": ["Stack"],
          "useCases": ["Use cases"],
          "recommendations": "Improvement.",
          "architecture": "Architecture type.",
          "mainFilePath": "Literal path to the file (e.g., 'src/main.py')",
          "entryPoints": [
            { "file": "path", "description": "why", "isMain": true }
          ]
        }
      `;

      const result = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: prompt,
        config: { responseMimeType: 'application/json' }
      });

      const parsed = JSON.parse(result.text || '{}');
      setAnalysis(parsed);
    } catch (err) {
      console.error("Analysis failed", err);
      setError("AI analysis failed. Try a different repo or ensure main branch exists.");
    } finally {
      setAnalyzing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
              No repositories synced.
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
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium truncate text-gray-200">{repo.full_name}</span>
                    <span className="text-[10px] text-gray-500 font-mono">{repo.default_branch}</span>
                  </div>
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
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col bg-[#0d1117] relative">
        {selectedRepo ? (
          <div className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full">
            <div className="flex items-start justify-between mb-8">
              <div className="flex items-center gap-4">
                <img src={selectedRepo.owner.avatar_url} className="w-16 h-16 rounded-xl border-2 border-gray-800 shadow-xl" alt={selectedRepo.owner.login} />
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h1 className="text-3xl font-bold text-white tracking-tight">{selectedRepo.name}</h1>
                    <span className="px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-[10px] font-mono text-gray-400">{selectedRepo.default_branch}</span>
                  </div>
                  <a href={selectedRepo.html_url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline flex items-center gap-1 text-sm font-medium">
                    {selectedRepo.full_name} <i data-lucide="external-link" className="w-3 h-3"></i>
                  </a>
                </div>
              </div>
            </div>

            <div className="relative">
              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-6">
                  <div className="relative">
                    <div className="w-20 h-20 border-4 border-blue-500/10 border-t-blue-500 rounded-full animate-spin"></div>
                    <i data-lucide="search" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 w-8 h-8 animate-pulse"></i>
                  </div>
                  <p className="text-xl font-medium text-white">Deep Scanning Repository...</p>
                </div>
              ) : analysis ? (
                <div className="space-y-8 animate-in fade-in duration-500">
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

                  {/* Main Entry Point Highlight with Copy Button */}
                  <div className="bg-blue-600/10 border border-blue-500/30 p-8 rounded-2xl relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                      <i data-lucide="terminal" className="w-32 h-32 text-blue-400"></i>
                    </div>
                    <div className="relative z-10">
                      <div className="flex items-center gap-2 mb-4">
                        <span className="px-2 py-0.5 bg-blue-500 text-[10px] font-black uppercase tracking-tighter rounded text-white shadow-[0_0_10px_rgba(59,130,246,0.5)]">Recommended for Deployment</span>
                        <h3 className="text-sm font-bold text-blue-400 uppercase tracking-widest">Main File Path</h3>
                      </div>
                      
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex-1 bg-black/50 p-4 rounded-xl border border-white/10 font-mono text-xl text-white break-all shadow-inner">
                          {analysis.mainFilePath || "Not detected"}
                        </div>
                        <button 
                          onClick={() => copyToClipboard(analysis.mainFilePath)}
                          className={`flex items-center justify-center gap-2 px-6 py-4 rounded-xl font-bold transition-all transform active:scale-95 ${copied ? 'bg-green-600 text-white' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-[0_0_20px_rgba(37,99,235,0.3)]'}`}
                        >
                          <i data-lucide={copied ? "check" : "copy"} className="w-5 h-5"></i>
                          {copied ? 'Copied!' : 'Copy Path'}
                        </button>
                      </div>
                      <p className="mt-4 text-xs text-gray-500 italic">
                        Paste this into the "Main file path" field in your hosting platform.
                      </p>
                    </div>
                  </div>

                  {/* Other Entry Points */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-widest flex items-center gap-2 px-1">
                      <i data-lucide="map-pin" className="w-4 h-4 text-blue-400"></i>
                      Navigational Guide
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {analysis.entryPoints.map((entry, idx) => (
                        <div key={idx} className={`bg-gray-800/40 border p-4 rounded-xl border-gray-700 hover:border-blue-500/30 transition-colors group`}>
                          <div className="flex items-start gap-3">
                            <div className="p-2 rounded-lg bg-gray-700/30">
                              <i data-lucide="file-text" className="w-4 h-4 text-gray-400"></i>
                            </div>
                            <div>
                              <div className="text-blue-400 font-mono text-sm font-bold mb-1 truncate max-w-[280px]">{entry.file}</div>
                              <p className="text-xs text-gray-400 leading-normal">{entry.description}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-center py-20 text-gray-600">
                   <i data-lucide="alert-circle" className="w-12 h-12 mx-auto mb-4 opacity-20"></i>
                   <p>Analysis failed or no repository selected.</p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center max-w-2xl mx-auto">
            <div className="w-20 h-20 bg-blue-600/10 rounded-3xl flex items-center justify-center mb-6 border border-blue-500/20">
              <i data-lucide="github" className="w-10 h-10 text-blue-500"></i>
            </div>
            <h2 className="text-3xl font-black text-white mb-4">Find Your Entry Point</h2>
            <p className="text-gray-400 text-lg mb-8 leading-relaxed">
              Struggling to find which file starts your app? Enter a repo URL above to get the exact path needed for Streamlit, Vercel, or Heroku deployments.
            </p>
            <div className="grid grid-cols-2 gap-4 w-full">
              <div onClick={() => fetchRepo('facebook/react')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left group">
                <span className="text-[10px] text-blue-500 font-bold uppercase tracking-tighter">Example</span>
                <p className="font-bold text-white group-hover:text-blue-400">facebook/react</p>
              </div>
              <div onClick={() => fetchRepo('streamlit/streamlit-example')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left group">
                <span className="text-[10px] text-blue-500 font-bold uppercase tracking-tighter">Python Example</span>
                <p className="font-bold text-white group-hover:text-blue-400">streamlit/streamlit-example</p>
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
      }, [selectedRepo, syncedRepos, loading, analyzing, analysis, error, copied])}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
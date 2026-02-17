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

interface Analysis {
  summary: string;
  techStack: string[];
  useCases: string[];
  recommendations: string;
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
      if (!response.ok) throw new Error('Repository not found or API rate limit exceeded.');
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
      // Fetch README if possible
      let readme = "No README found.";
      try {
        const readmeRes = await fetch(`https://api.github.com/repos/${repo.full_name}/readme`, {
          headers: { 'Accept': 'application/vnd.github.v3.raw' }
        });
        if (readmeRes.ok) readme = await readmeRes.text();
      } catch (e) {}

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const prompt = `
        Analyze the following GitHub repository information and provide a structured insight.
        Repository: ${repo.full_name}
        Description: ${repo.description}
        Primary Language: ${repo.language}
        README Sample: ${readme.substring(0, 2000)}

        Return your response as a JSON object with the following structure:
        {
          "summary": "A concise 2-sentence summary of what this project does.",
          "techStack": ["List", "of", "likely", "technologies"],
          "useCases": ["Case 1", "Case 2"],
          "recommendations": "One specific suggestion to improve this project."
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
      setError("AI analysis failed. Please try again later.");
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
              className="w-full bg-[#0d1117] border border-gray-700 rounded-md py-2 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchQuery && fetchRepo(searchQuery)}
            />
            <button 
              onClick={() => searchQuery && fetchRepo(searchQuery)}
              className="absolute right-2 top-1.5 text-gray-400 hover:text-white"
            >
              <i data-lucide="plus-circle" className="w-5 h-5"></i>
            </button>
          </div>
          {error && <p className="text-red-400 text-xs mt-2 px-1">{error}</p>}
        </div>

        <nav className="flex-1 overflow-y-auto p-4 space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 px-2">Synced Repositories</h2>
          {syncedRepos.length === 0 ? (
            <p className="text-gray-600 text-sm px-2 italic">No repositories synced yet.</p>
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
                  <i data-lucide="x" className="w-4 h-4"></i>
                </button>
              </div>
            ))
          )}
        </nav>
        
        <div className="p-6 border-t border-gray-800 text-xs text-gray-500">
          Powered by Gemini 3 Pro
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

            {/* Description Card */}
            <div className="glass rounded-xl p-6 mb-8">
              <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">About</h3>
              <p className="text-lg text-gray-200 leading-relaxed">
                {selectedRepo.description || "No description provided."}
              </p>
              {selectedRepo.language && (
                <div className="mt-4 flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-blue-500"></span>
                  <span className="text-sm text-gray-400">{selectedRepo.language}</span>
                </div>
              )}
            </div>

            {/* AI Analysis Section */}
            <div className="relative">
              <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
                <i data-lucide="sparkles" className="text-blue-400 w-5 h-5"></i>
                AI Insights & Analysis
              </h2>

              {analyzing ? (
                <div className="flex flex-col items-center justify-center py-20 space-y-4">
                  <div className="relative">
                    <div className="w-16 h-16 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
                    <i data-lucide="zap" className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-blue-400 w-6 h-6 animate-pulse"></i>
                  </div>
                  <p className="text-gray-400 animate-pulse font-medium">Gemini is parsing repository architecture...</p>
                </div>
              ) : analysis ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Summary Card */}
                  <div className="bg-gradient-to-br from-blue-900/10 to-transparent border border-gray-800 rounded-xl p-6">
                    <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                      <i data-lucide="book-open" className="w-4 h-4 text-blue-400"></i>
                      Project Purpose
                    </h4>
                    <p className="text-gray-300 leading-relaxed">{analysis.summary}</p>
                  </div>

                  {/* Tech Stack Card */}
                  <div className="bg-gradient-to-br from-purple-900/10 to-transparent border border-gray-800 rounded-xl p-6">
                    <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                      <i data-lucide="layers" className="w-4 h-4 text-purple-400"></i>
                      Tech Stack
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {analysis.techStack.map((tech, i) => (
                        <span key={i} className="px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs text-gray-300">
                          {tech}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Use Cases Card */}
                  <div className="bg-gradient-to-br from-green-900/10 to-transparent border border-gray-800 rounded-xl p-6">
                    <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                      <i data-lucide="target" className="w-4 h-4 text-green-400"></i>
                      Key Use Cases
                    </h4>
                    <ul className="space-y-2">
                      {analysis.useCases.map((useCase, i) => (
                        <li key={i} className="text-gray-300 text-sm flex items-start gap-2">
                          <span className="text-green-500 font-bold">•</span> {useCase}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* Recommendations Card */}
                  <div className="bg-gradient-to-br from-orange-900/10 to-transparent border border-gray-800 rounded-xl p-6">
                    <h4 className="font-bold text-white mb-3 flex items-center gap-2">
                      <i data-lucide="lightbulb" className="w-4 h-4 text-orange-400"></i>
                      AI Recommendation
                    </h4>
                    <p className="text-gray-300 text-sm italic">"{analysis.recommendations}"</p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-10 text-gray-600 italic">
                  Select a repository to begin analysis.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
            <div className="w-20 h-20 bg-gray-800/50 rounded-2xl flex items-center justify-center mb-6">
              <i data-lucide="github" className="w-10 h-10 text-gray-600"></i>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">Sync Your Workflow</h2>
            <p className="text-gray-500 max-w-sm">
              Search and add any public GitHub repository to get instant AI-powered summaries, tech stack analysis, and project insights.
            </p>
            <div className="mt-8 grid grid-cols-2 gap-4 w-full max-w-lg">
              <div onClick={() => fetchRepo('facebook/react')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left">
                <p className="text-xs text-gray-500 mb-1">Featured</p>
                <p className="font-bold text-white">facebook/react</p>
              </div>
              <div onClick={() => fetchRepo('vercel/next.js')} className="repo-card glass p-4 rounded-xl cursor-pointer text-left">
                <p className="text-xs text-gray-500 mb-1">Featured</p>
                <p className="font-bold text-white">vercel/next.js</p>
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
      }, [selectedRepo, syncedRepos, loading, analyzing, analysis])}
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
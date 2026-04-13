import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowLeft, Terminal, Cpu, Zap, Info } from 'lucide-react';
import KotlinEditor from '@shared/components/KotlinEditor';

const EnvCheck: React.FC = () => {
  const navigate = useNavigate();
  const [testComplete, setTestComplete] = useState(false);

  return (
    <div className="min-h-screen bg-[#0D1117] text-white font-outfit p-8">
      <header className="max-w-4xl mx-auto flex justify-between items-center mb-12">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-black">Environment Verification</h1>
            <p className="text-[10px] font-black text-white/30 uppercase tracking-[0.2em] mt-1">Status: Checking Compiler Connectivity</p>
          </div>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 bg-accent/10 border border-accent/20 rounded-xl">
          <ShieldCheck size={16} className="text-accent" />
          <span className="text-[10px] font-black uppercase text-accent tracking-widest">System Ready</span>
        </div>
      </header>

      <main className="max-w-4xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {[
            { icon: <Terminal size={20} />, label: 'Kotlin SDK', status: 'Online', desc: 'v1.9.23' },
            { icon: <Cpu size={20} />, label: 'Architecture', status: 'JS/JVM', desc: 'Browser-based' },
            { icon: <Zap size={20} />, label: 'Latency', status: 'Low', desc: '< 200ms' }
          ].map((item, i) => (
            <div key={i} className="bg-white/5 border border-white/10 p-6 rounded-3xl">
              <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-4 text-accent/60">
                {item.icon}
              </div>
              <p className="text-[10px] font-black text-white/30 uppercase tracking-widest leading-none">{item.label}</p>
              <div className="flex items-baseline gap-2 mt-2">
                <p className="text-2xl font-black">{item.status}</p>
                <p className="text-[10px] font-bold text-white/20 uppercase">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="glass-panel rounded-[2.5rem] border border-white/10 overflow-hidden shadow-2xl">
          <div className="bg-white/5 px-8 py-6 border-b border-white/10 flex justify-between items-center">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-[11px] font-black uppercase tracking-widest">Interactive Test Bench</span>
            </div>
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-500/20" />
              <div className="w-3 h-3 rounded-full bg-yellow-500/20" />
              <div className="w-3 h-3 rounded-full bg-green-500/20" />
            </div>
          </div>
          
          <div className="p-8">
            <div className="bg-blue-500/10 border border-blue-500/20 p-5 rounded-2xl flex gap-4 mb-8">
              <Info className="text-blue-400 shrink-0" size={20} />
              <p className="text-sm text-blue-200/70 leading-relaxed font-medium">
                Type the following snippet into the editor and click <strong className="text-blue-400">Run</strong>. If you see "System Verified" in the console output, your browser is fully compatible with coding assessments.
              </p>
            </div>

            <KotlinEditor 
              height="250px"
              initialCode={`fun main() {\n    println("System Verified")\n}`}
              className="mb-8"
            />

            <button 
              onClick={() => setTestComplete(true)}
              className="w-full py-5 rounded-2xl bg-white text-[#0D1117] font-black uppercase text-xs tracking-[0.2em] hover:bg-white/90 active:scale-[0.98] transition-all shadow-xl"
            >
              Mark Verification as Complete
            </button>
          </div>
        </div>

        {testComplete && (
          <div className="mt-8 p-6 bg-green-500/10 border border-green-500/20 rounded-3xl flex items-center justify-between animate-in fade-in zoom-in-95 duration-500">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-green-500/20 flex items-center justify-center text-green-400">
                <ShieldCheck size={24} />
              </div>
              <div>
                <h4 className="font-black text-lg">Platform Certified</h4>
                <p className="text-xs text-green-400/60 font-bold uppercase tracking-widest">Your environment is exam-ready</p>
              </div>
            </div>
            <button onClick={() => navigate('/dashboard')} className="px-8 py-3 bg-green-500 text-primary font-black rounded-xl text-xs uppercase tracking-widest hover:bg-green-600 transition-all">
              Return to Dashboard
            </button>
          </div>
        )}
      </main>

      <footer className="max-w-4xl mx-auto mt-20 pb-12 text-center">
        <p className="text-[10px] font-black text-white/10 uppercase tracking-[0.3em]">SecureLab Laboratory Intelligence v2.0</p>
      </footer>
    </div>
  );
};

export default EnvCheck;

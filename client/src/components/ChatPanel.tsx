import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { MessageSquare, Send, X, Sparkles, Check, ListTodo, Sun, Moon } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import ReactMarkdown from 'react-markdown';

interface ProjectTaskSelection {
  id: string;
  project_code: string;
  project_name: string;
  progress: number;
  deadline: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  projects?: ProjectTaskSelection[];
  planSubmitted?: boolean;
}

// ── Custom Loader ────────────────────────────────────────────────────────────
const ARIALoader = () => (
  <div style={{ position: 'relative', width: '2.5em', height: '2.5em', transform: 'rotate(165deg)', fontSize: '12px' }}>
    <style>{`
      @keyframes aria-before {
        0%   { width:.5em; box-shadow:1em -.5em rgba(225,20,98,.75),-1em .5em rgba(111,202,220,.75); }
        35%  { width:2.5em; box-shadow:0 -.5em rgba(225,20,98,.75),0 .5em rgba(111,202,220,.75); }
        70%  { width:.5em; box-shadow:-1em -.5em rgba(225,20,98,.75),1em .5em rgba(111,202,220,.75); }
        100% { box-shadow:1em -.5em rgba(225,20,98,.75),-1em .5em rgba(111,202,220,.75); }
      }
      @keyframes aria-after {
        0%   { height:.5em; box-shadow:.5em 1em rgba(61,184,143,.75),-.5em -1em rgba(233,169,32,.75); }
        35%  { height:2.5em; box-shadow:.5em 0 rgba(61,184,143,.75),-.5em 0 rgba(233,169,32,.75); }
        70%  { height:.5em; box-shadow:.5em -1em rgba(61,184,143,.75),-.5em 1em rgba(233,169,32,.75); }
        100% { box-shadow:.5em 1em rgba(61,184,143,.75),-.5em -1em rgba(233,169,32,.75); }
      }
      .aria-loader-inner::before {
        content:''; position:absolute; top:50%; left:50%;
        display:block; width:.5em; height:.5em; border-radius:.25em;
        transform:translate(-50%,-50%);
        animation: aria-before 2s infinite;
      }
      .aria-loader-inner::after {
        content:''; position:absolute; top:50%; left:50%;
        display:block; width:.5em; height:.5em; border-radius:.25em;
        transform:translate(-50%,-50%);
        animation: aria-after 2s infinite;
      }
    `}</style>
    <div className="aria-loader-inner" style={{ position: 'absolute', top: 'calc(50% - 1.25em)', left: 'calc(50% - 1.25em)', width: '2.5em', height: '2.5em' }} />
  </div>
);

// ── Intro Animation Screen ───────────────────────────────────────────────────
const IntroScreen = ({ onDone, isDark }: { onDone: () => void; isDark: boolean }) => {
  const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('show'), 100);
    const t2 = setTimeout(() => setPhase('exit'), 1800);
    const t3 = setTimeout(() => onDone(), 2300);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  const bg = isDark ? '#0f0f1a' : '#f8f7ff';
  const textColor = isDark ? '#ffffff' : '#3730a3';
  const subColor = isDark ? '#7c5cbf' : '#6d5acd';
  const dotColor = isDark ? '#7c5cbf' : '#8b5cf6';

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 50, borderRadius: '16px',
      background: bg, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      opacity: phase === 'enter' ? 0 : phase === 'show' ? 1 : 0,
      transform: phase === 'enter' ? 'scale(0.95)' : phase === 'show' ? 'scale(1)' : 'scale(1.03)',
      transition: 'opacity 0.4s ease, transform 0.4s ease',
      pointerEvents: 'none',
    }}>
      {/* Sparkle Loader */}
      <div style={{ marginBottom: '24px', display: 'flex', justifyContent: 'center', alignItems: 'center', height: '120px' }}>
        <ARIALoader />
      </div>

      {/* ARIA Title */}
      <h2 style={{
        color: textColor,
        fontSize: '22px',
        fontWeight: '700',
        letterSpacing: '3px',
        marginBottom: '8px',
        marginTop: 0,
      }}>
        ARIA
      </h2>

      {/* Subtitle */}
      <p style={{
        color: subColor,
        fontSize: '13px',
        letterSpacing: '1px',
        margin: 0,
      }}>
        Your work assistant is ready
      </p>

      {/* Dots */}
      <div style={{ display: 'flex', gap: '6px', marginTop: '20px' }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: '6px',
            height: '6px',
            borderRadius: '50%',
            background: dotColor,
            animation: 'dotBounce 1.2s ease infinite',
            animationDelay: `${i * 0.2}s`,
          }} />
        ))}
      </div>
    </div>
  );
};

// ── Main ChatPanel ───────────────────────────────────────────────────────────
export default function ChatPanel() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showIntro, setShowIntro] = useState(false);
  const [chatReady, setChatReady] = useState(false);
  const [isDark, setIsDark] = useState(true);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedTasks, setSelectedTasks] = useState<Record<string, boolean>>({});
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  if (!user) return null;

  const handleOpen = () => {
    setIsOpen(true);
    setShowIntro(true);
    setChatReady(false);
  };

  const handleClose = () => {
    setIsOpen(false);
    setShowIntro(false);
    setChatReady(false);
  };

  const handleIntroEnd = () => {
    setShowIntro(false);
    setChatReady(true);
  };

  // ── Theme tokens ─────────────────────────────────────────────────────────
  const t = isDark ? {
    panel: '#0d0d1a',
    header: 'linear-gradient(135deg,#4c1d95,#312e81)',
    headerBorder: '#4c1d95',
    msgArea: '#0d0d1a',
    userBubble: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    userText: '#ffffff',
    botBubble: '#1a1a2e',
    botBorder: '#2d2b55',
    botText: '#e2e0ff',
    inputBg: '#1a1a2e',
    inputBorder: '#2d2b55',
    inputText: '#e2e0ff',
    inputPlaceholder: '#6b6890',
    footerBg: '#0d0d1a',
    footerBorder: '#1f1d3a',
    suggestionBg: '#1a1a2e',
    suggestionBorder: '#2d2b55',
    subText: '#7c6fcd',
    nameText: '#c4b5fd',
    scrollThumb: '#2d2b55',
  } : {
    panel: '#ffffff',
    header: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    headerBorder: '#7c3aed',
    msgArea: '#fafafa',
    userBubble: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
    userText: '#ffffff',
    botBubble: '#f0efff',
    botBorder: '#ddd6fe',
    botText: '#3730a3',
    inputBg: '#f0efff',
    inputBorder: '#ddd6fe',
    inputText: '#3730a3',
    inputPlaceholder: '#a5a0d4',
    footerBg: '#f8f7ff',
    footerBorder: '#ede9fe',
    suggestionBg: '#f0efff',
    suggestionBorder: '#ddd6fe',
    subText: '#6d5acd',
    nameText: '#4f46e5',
    scrollThumb: '#ddd6fe',
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    setLoading(true);

    const userMsgId = Math.random().toString();
    const assistantMsgId = Math.random().toString();

    setMessages((prev) => [...prev, { id: userMsgId, role: 'user', content: userMessage }]);

    const chatHistory = messages.map((m) => ({
      role: m.role === 'user' ? 'user' as const : 'assistant' as const,
      content: m.content,
    }));

    try {
      const response = await fetch('/api/rag/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMessage,
          history: chatHistory,
          employeeId: user.id,
          employeeCode: user.employeeCode,
          role: user.role,
          department: user.department,
          employeeName: user.name,
        }),
      });

      if (!response.body) throw new Error('No response body');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let assistantText = '';
      let interactiveProjects: ProjectTaskSelection[] = [];

      setMessages((prev) => [...prev, { id: assistantMsgId, role: 'assistant', content: '' }]);

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunkValue = decoder.decode(value);
        const lines = chunkValue.split('\n\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.substring(6));
              if (data.type === 'text') {
                assistantText += data.content;
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantMsgId ? { ...m, content: assistantText } : m)
                );
              } else if (data.type === 'interactive_daily_plan') {
                interactiveProjects = data.projects;
                setMessages((prev) =>
                  prev.map((m) => m.id === assistantMsgId ? { ...m, projects: interactiveProjects } : m)
                );
              }
            } catch (_) { }
          }
        }
      }
    } catch (error: any) {
      setMessages((prev) => [...prev, {
        id: Math.random().toString(),
        role: 'assistant',
        content: `⚠️ Failed to fetch response: ${error.message}`,
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleTask = (taskId: string) => {
    setSelectedTasks((prev) => ({ ...prev, [taskId]: !prev[taskId] }));
  };

  const handleSubmitDailyPlan = async (messageId: string, projects: ProjectTaskSelection[]) => {
    const selected = projects.filter((p) => selectedTasks[p.id]);
    if (selected.length === 0) return;
    try {
      const payload = {
        employeeId: user.id,
        date: new Date().toISOString().split('T')[0],
        tasks: selected.map((s) => ({
          taskId: s.id,
          projectName: s.project_name,
          taskName: `${s.project_code} Daily Task`,
        })),
      };
      const res = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? { ...m, content: `${m.content}\n\n✅ Daily Plan Created Successfully!`, planSubmitted: true }
              : m
          )
        );
      } else {
        alert('Failed to submit daily plan.');
      }
    } catch (err: any) {
      alert(`Error submitting plan: ${err.message}`);
    }
  };

  // ── Styles ───────────────────────────────────────────────────────────────
  const styles = `
    @keyframes slideUp {
      from { opacity:0; transform:translateY(10px); }
      to   { opacity:1; transform:translateY(0); }
    }
    @keyframes panelIn {
      from { opacity:0; transform:translateY(16px) scale(0.97); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    @keyframes dotBounce {
      0%,80%,100% { transform:translateY(0); opacity:0.4; }
      40%          { transform:translateY(-5px); opacity:1; }
    }
    .aria-msg { animation: slideUp 0.25s ease forwards; }
    .aria-panel { animation: panelIn 0.3s cubic-bezier(.22,1,.36,1) forwards; }
    .aria-scroll::-webkit-scrollbar { width:4px; }
    .aria-scroll::-webkit-scrollbar-track { background:transparent; }
    .aria-scroll::-webkit-scrollbar-thumb { background:${t.scrollThumb}; border-radius:99px; }
    .aria-dot { display:inline-block; width:6px; height:6px; border-radius:50%; background:#7c3aed; margin:0 2px; }
    .aria-dot:nth-child(1){animation:dotBounce 1.2s .0s infinite}
    .aria-dot:nth-child(2){animation:dotBounce 1.2s .2s infinite}
    .aria-dot:nth-child(3){animation:dotBounce 1.2s .4s infinite}
    .aria-btn:hover { opacity:0.85; }
    .aria-send:not(:disabled):hover { transform:scale(1.05); }
    .aria-send { transition:transform .15s ease; }
  `;

  return (
    <>
      <style>{styles}</style>
      <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 50, display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>

        {/* ── Chat Panel ── */}
        {isOpen && (
          <div
            className="aria-panel"
            style={{
              marginBottom: '16px', width: '360px', height: '480px',
              borderRadius: '16px', overflow: 'hidden', position: 'relative',
              background: t.panel,
              border: `1px solid ${t.botBorder}`,
              boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Intro overlay */}
            {showIntro && <IntroScreen onDone={handleIntroEnd} isDark={isDark} />}

            {/* ── Header ── */}
            <div style={{
              background: t.header,
              padding: '12px 16px',
              display: 'flex', alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {/* ARIA avatar */}
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: 'rgba(255,255,255,0.15)',
                  border: '1.5px solid rgba(255,255,255,0.3)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '15px',
                }}>
                  🤖
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#ffffff', lineHeight: '1.2' }}>ARIA</div>
                  <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.65)', lineHeight: '1.2' }}>Your work assistant</div>
                </div>
                {/* Online dot */}
                <div style={{
                  width: '7px', height: '7px', borderRadius: '50%',
                  background: '#4ade80',
                  boxShadow: '0 0 6px #4ade80',
                }} />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {/* Dark/Light toggle */}
                <button
                  onClick={() => setIsDark(!isDark)}
                  className="aria-btn"
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white', transition: 'background .2s',
                  }}
                  title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                >
                  {isDark
                    ? <Sun style={{ width: '14px', height: '14px' }} />
                    : <Moon style={{ width: '14px', height: '14px' }} />
                  }
                </button>

                {/* Close */}
                <button
                  onClick={handleClose}
                  className="aria-btn"
                  style={{
                    width: '32px', height: '32px', borderRadius: '50%',
                    background: 'rgba(255,255,255,0.12)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', color: 'white',
                  }}
                >
                  <X style={{ width: '14px', height: '14px' }} />
                </button>
              </div>
            </div>

            {/* ── Messages ── */}
            <div
              className="aria-scroll"
              style={{
                flex: 1, overflowY: 'auto', padding: '16px',
                display: 'flex', flexDirection: 'column', gap: '12px',
                background: t.msgArea,
              }}
            >
              {/* Empty state */}
              {chatReady && messages.length === 0 && (
                <div className="aria-msg" style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: '100%', textAlign: 'center', padding: '0 16px',
                }}>
                  <div style={{ fontSize: '32px', marginBottom: '12px' }}>👋</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: t.nameText, marginBottom: '4px' }}>
                    Hello, {user.name}!
                  </div>
                  <div style={{ fontSize: '12px', color: t.subText, marginBottom: '16px' }}>
                    I'm ARIA. What can I help you with today?
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%' }}>
                    {[
                      '📋 What are my assigned tasks?',
                      '🕐 Show me my timesheet for today',
                      '🌴 Do I have any pending leaves?',
                      ...(['manager', 'admin', 'hr'].includes(user.role) ? ['👥 Show all pending leave requests'] : []),
                    ].map((s) => (
                      <button
                        key={s}
                        onClick={() => { setInput(s.slice(3).trim()); }}
                        style={{
                          background: t.suggestionBg,
                          border: `1px solid ${t.suggestionBorder}`,
                          borderRadius: '10px', padding: '8px 12px',
                          fontSize: '12px', color: t.botText,
                          textAlign: 'left', cursor: 'pointer',
                          transition: 'opacity .15s',
                        }}
                        className="aria-btn"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Messages */}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className="aria-msg"
                  style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  {/* Bot avatar row */}
                  {m.role === 'assistant' && (
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', maxWidth: '85%' }}>
                      <div style={{
                        width: '24px', height: '24px', borderRadius: '50%',
                        background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '12px', flexShrink: 0,
                      }}>🤖</div>
                      <div style={{
                        background: t.botBubble,
                        border: `1px solid ${t.botBorder}`,
                        color: t.botText,
                        borderRadius: '16px 16px 16px 4px',
                        padding: '8px 12px', fontSize: '13px',
                        lineHeight: '1.5', whiteSpace: 'pre-wrap',
                        minHeight: m.content === '' ? '40px' : 'auto',
                        display: 'flex', alignItems: 'center',
                      }}>
                        {m.content === '' && loading ? (
                          <><span className="aria-dot" /><span className="aria-dot" /><span className="aria-dot" /></>
                        ) : (
                          <div style={{ width: '100%' }}>
                            <ReactMarkdown
                              components={{
                                p: ({ node, ...props }) => <p style={{ margin: 0, padding: 0 }} {...props} />,
                                ul: ({ node, ...props }) => <ul style={{ margin: '4px 0', paddingLeft: '20px', listStyleType: 'disc' }} {...props} />,
                                ol: ({ node, ...props }) => <ol style={{ margin: '4px 0', paddingLeft: '20px', listStyleType: 'decimal' }} {...props} />,
                                li: ({ node, ...props }) => <li style={{ margin: '2px 0' }} {...props} />,
                              }}
                            >
                              {m.content}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* User bubble */}
                  {m.role === 'user' && (
                    <div style={{
                      background: t.userBubble,
                      color: t.userText,
                      borderRadius: '16px 16px 4px 16px',
                      padding: '8px 12px', fontSize: '13px',
                      lineHeight: '1.5', whiteSpace: 'pre-wrap',
                      maxWidth: '85%',
                    }}>
                      {m.content}
                    </div>
                  )}

                  {/* Daily plan selector */}
                  {m.projects && m.projects.length > 0 && !m.planSubmitted && (
                    <div style={{
                      marginTop: '8px', width: '100%',
                      background: t.botBubble,
                      border: `1px solid ${t.botBorder}`,
                      borderRadius: '12px', padding: '12px',
                    }}>
                      <div style={{ fontSize: '11px', fontWeight: '600', color: '#a78bfa', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <ListTodo style={{ width: '14px', height: '14px' }} />
                        Select projects for your daily plan:
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '160px', overflowY: 'auto' }}>
                        {m.projects.map((proj) => (
                          <div
                            key={proj.id}
                            onClick={() => handleToggleTask(proj.id)}
                            style={{
                              display: 'flex', alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px', borderRadius: '8px', cursor: 'pointer',
                              background: selectedTasks[proj.id] ? 'rgba(124,58,237,0.15)' : t.suggestionBg,
                              border: `1px solid ${selectedTasks[proj.id] ? '#7c3aed' : t.suggestionBorder}`,
                              fontSize: '12px', transition: 'all .15s',
                            }}
                          >
                            <div>
                              <div style={{ fontWeight: '500', color: t.botText }}>{proj.project_name}</div>
                              <div style={{ fontSize: '10px', color: t.subText }}>{proj.project_code} • {proj.progress}%</div>
                            </div>
                            <div style={{
                              width: '16px', height: '16px', borderRadius: '4px',
                              border: `1.5px solid ${selectedTasks[proj.id] ? '#7c3aed' : t.suggestionBorder}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {selectedTasks[proj.id] && <Check style={{ width: '10px', height: '10px', color: '#7c3aed' }} />}
                            </div>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={() => handleSubmitDailyPlan(m.id, m.projects!)}
                        style={{
                          marginTop: '10px', width: '100%', padding: '8px',
                          background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                          border: 'none', borderRadius: '8px',
                          color: 'white', fontSize: '12px', fontWeight: '600',
                          cursor: 'pointer',
                        }}
                      >
                        Create Daily Plan
                      </button>
                    </div>
                  )}
                </div>
              ))}

              {/* Standalone loading indicator (when no empty bubble yet) */}
              {loading && messages[messages.length - 1]?.role === 'user' && (
                <div className="aria-msg" style={{ display: 'flex', alignItems: 'flex-end', gap: '8px' }}>
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px',
                  }}>🤖</div>
                  <div style={{
                    background: t.botBubble, border: `1px solid ${t.botBorder}`,
                    borderRadius: '16px 16px 16px 4px', padding: '8px 12px',
                  }}>
                    <ARIALoader />
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {/* ── Input ── */}
            <form
              onSubmit={handleSend}
              style={{
                borderTop: `1px solid ${t.footerBorder}`,
                padding: '12px', background: t.footerBg,
                display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0,
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask ARIA anything..."
                disabled={loading}
                style={{
                  flex: 1, height: '38px', borderRadius: '10px',
                  background: t.inputBg,
                  border: `1px solid ${t.inputBorder}`,
                  color: t.inputText, fontSize: '13px',
                  padding: '0 12px', outline: 'none',
                }}
                onFocus={(e) => e.target.style.borderColor = '#7c3aed'}
                onBlur={(e) => e.target.style.borderColor = t.inputBorder}
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="aria-send"
                style={{
                  width: '38px', height: '38px', borderRadius: '10px', flexShrink: 0,
                  background: loading || !input.trim()
                    ? 'rgba(124,58,237,0.3)'
                    : 'linear-gradient(135deg,#7c3aed,#4f46e5)',
                  border: 'none', cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white',
                }}
              >
                <Send style={{ width: '15px', height: '15px' }} />
              </button>
            </form>
          </div>
        )}

        {/* ── FAB ── */}
        <button
          onClick={isOpen ? handleClose : handleOpen}
          style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: 'linear-gradient(135deg,#7c3aed,#4f46e5)',
            border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(124,58,237,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'transform .2s, box-shadow .2s',
            color: 'white',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.08)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(124,58,237,0.6)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(124,58,237,0.5)'; }}
        >
          {isOpen
            ? <X style={{ width: '22px', height: '22px' }} />
            : <Sparkles style={{ width: '22px', height: '22px' }} />
          }
        </button>
      </div>
    </>
  );
}

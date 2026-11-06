'use client';

import { useEffect, useRef, useState } from 'react';
import { Playfair_Display } from 'next/font/google';
import { Send } from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const playfair = Playfair_Display({ subsets: ['latin'], style: ['normal', 'italic'] });

// ---------- Konfigurasi ----------
// Jangan taruh API key Gemini di sini. Panggil route handler Next.js kamu
// (mis. app/api/chat/route.js) yang menyimpan key di environment variable server.
const CHAT_API_URL = '/api/chat';
const CHAT_TIMEOUT_MS = 120000;// batas waktu tunggu respons
const MAX_HISTORY = 10;        // jumlah pesan terakhir yang dikirim sebagai konteks
const MAX_INPUT_LENGTH = 500;  // batas panjang pesan user

const SUGGESTIONS = [
  'Apa hubungan cuaca panas dengan kehamilan?',
  'Apa yang perlu disiapkan saat kualitas udara buruk?',
  'Bagaimana melindungi diri dari sinar UV?',
  'Apa itu Heat Index dan kenapa perlu diperhatikan?'
];

const WELCOME_MESSAGE = {
  id: 'welcome',
  role: 'bot',
  text: 'Halo Bu! 👋 kami teman memahami lingkungan dan kesehatan perempuan. Mau tanya apa hari ini?',
};

// ---------- Render markdown sederhana (tanpa dangerouslySetInnerHTML) ----------
function renderInline(text) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

function MarkdownText({ text }) {
  const blocks = [];
  let listItems = [];

  const flushList = () => {
    if (listItems.length) {
      blocks.push(
        <ul key={`ul-${blocks.length}`} className="list-disc space-y-1 pl-5">
          {listItems.map((item, i) => (
            <li key={i}>{renderInline(item)}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    const listMatch = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      listItems.push(listMatch[2]);
    } else {
      flushList();
      if (line) blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line)}</p>);
    }
  });
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 py-1" aria-label="Bot sedang mengetik">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="size-1.5 animate-bounce rounded-full bg-[#4A7C59]/60"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

// ---------- Komponen chatbot ----------
function ChatbotSection() {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  const messagesRef = useRef(null);
  const inputRef = useRef(null);
  const abortRef = useRef(null);

  // Auto-scroll ke pesan terbaru (hanya di dalam kotak chat)
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isSending]);

  // Batalkan request yang masih berjalan saat komponen di-unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  const friendlyError = (err) => {
    if (err.name === 'AbortError') {
      return 'Maaf Bu, butuh waktu terlalu lama untuk menjawab. Coba kirim lagi ya 🙏';
    }
    if (err.message === 'RATE_LIMIT') {
      return 'lagi kebanjiran pertanyaan nih 😅 Tunggu sebentar lalu coba lagi ya, Bu.';
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return 'Sepertinya koneksi internet Ibu sedang terputus. Cek koneksi dulu ya 📶';
    }
    return 'Maaf Bu, lagi ada gangguan. Coba lagi beberapa saat lagi ya 🙏';
  };

  // Riwayat untuk backend: tanpa sapaan awal, tanpa pesan gagal/error, harus diawali pesan user.
  const buildHistory = (list) => {
    const history = list
      .filter((m) => m.id !== 'welcome' && !m.isError && !m.failed)
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text }));
    while (history.length && history[0].role !== 'user') history.shift();
    return history;
  };

  const sendMessage = async (presetText) => {
    if (isSending) return;

    const text = (typeof presetText === 'string' ? presetText : input).trim();
    if (!text) return;

    const userMsg = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: text.slice(0, MAX_INPUT_LENGTH),
    };
    const nextMessages = [...messages, userMsg];

    setMessages(nextMessages);
    setInput('');
    setIsSending(true);

    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg.text  }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(res.status === 429 ? 'RATE_LIMIT' : `HTTP_${res.status}`);
      }

      const data = await res.json();
      const reply = (data.reply || '').trim();
      if (!reply) throw new Error('EMPTY_REPLY');

      setMessages((prev) => [...prev, { id: `b-${Date.now()}`, role: 'bot', text: reply }]);
    } catch (err) {
      console.error('Gagal mengambil balasan:', err);
      setMessages((prev) => [
        ...prev.map((m) => (m.id === userMsg.id ? { ...m, failed: true } : m)),
        { id: `e-${Date.now()}`, role: 'bot', text: friendlyError(err), isError: true },
      ]);
    } finally {
      clearTimeout(timer);
      setIsSending(false);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <section id="chatbot" className="bg-[#FDF5EA] px-4 py-16 sm:px-6 md:py-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 md:grid-cols-2 md:gap-14">
        {/* ===== Kolom kiri: perkenalan + chip saran ===== */}
        <div>
          <h2
            className={cn(
              playfair.className,
              'text-4xl font-bold leading-tight tracking-tight text-[#2B2A28] md:text-5xl'
            )}
          >
            Haii <em className="font-semibold text-[#4A7C59]">Bu...</em> 👋
          </h2>

          <p className="mt-5 max-w-xl text-base leading-8 text-[#6B6560]">
            Aku akan membantumu memahami hubungan lingkungan dengan
            kesehatan perempuan. Hindari memasukkan data pribadi atau informasi kesehatan yang sensitif.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            {SUGGESTIONS.map((s) => (
              <Button
                key={s}
                type="button"
                variant="outline"
                disabled={isSending}
                onClick={() => sendMessage(s)}
                className="h-auto whitespace-normal rounded-full border-[#DCD8CC] bg-white/50 px-5 py-2.5 text-center text-[13px] font-normal text-[#2B2A28] transition-colors hover:border-[#4A7C59]/40 hover:bg-white hover:text-[#4A7C59]"
              >
                {s}
              </Button>
            ))}
          </div>
        </div>

        {/* ===== Kolom kanan: kotak chat ===== */}
        <div className="flex h-[520px] w-full flex-col overflow-hidden rounded-2xl border border-[#E4DFD3] bg-white shadow-[0_10px_40px_-12px_rgba(74,124,89,0.25)]">
          {/* Header */}
          <div className="flex items-center gap-3 bg-[#4A7C59] px-5 py-4 text-white">
            <Avatar className="size-10 bg-white/20">
              <AvatarFallback className="bg-white/20 text-lg">🌸</AvatarFallback>
            </Avatar>
            <div className="flex flex-col leading-tight">
              <strong className="text-sm font-semibold">Sycle</strong>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-white/85">
                <span className="size-2 animate-pulse rounded-full bg-emerald-300" /> Online
              </span>
            </div>
            <Badge className="ml-auto rounded-full border-0 bg-white/25 px-3 py-1 text-[11px] font-semibold text-white hover:bg-white/25">
              RAG System sesuai Evidence
            </Badge>
          </div>

          {/* Pesan */}
          <div
            ref={messagesRef}
            aria-live="polite"
            className="flex flex-1 flex-col gap-3 overflow-y-auto bg-[#FDF8F0] p-5"
          >
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
                  m.role === 'user'
                    ? 'self-end rounded-br-md bg-[#4A7C59] text-white'
                    : 'self-start rounded-bl-md bg-white text-[#2B2A28] shadow-sm',
                  m.isError && 'border border-amber-200 bg-amber-50 text-amber-900'
                )}
              >
                {m.role === 'user' ? <p>{m.text}</p> : <MarkdownText text={m.text} />}
              </div>
            ))}

            {isSending && (
              <div className="self-start rounded-2xl rounded-bl-md bg-white px-4 py-3 shadow-sm">
                <TypingIndicator />
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-[#EFEAE0] bg-white px-5 pb-3 pt-4">
            <div className="flex items-center gap-3">
              <Input
                ref={inputRef}
                value={input}
                maxLength={MAX_INPUT_LENGTH}
                disabled={isSending}
                placeholder="Ketik pertanyaan kamu..."
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                className="h-11 flex-1 rounded-full border-[#DCD8CC] bg-[#FDF5EA] px-5 text-sm placeholder:text-[#8A847C] focus-visible:border-[#4A7C59] focus-visible:ring-[#4A7C59]/25"
              />
              <Button
                type="button"
                size="icon"
                aria-label="Kirim pesan"
                disabled={isSending || !input.trim()}
                onClick={() => sendMessage()}
                className="size-11 shrink-0 rounded-full bg-[#4A7C59] text-white hover:bg-[#3E6A4C]"
              >
                <Send className="size-5" />
              </Button>
            </div>
            <p className="mt-3 text-center text-[11px] italic text-[#6B6560]">
              (*memberikan informasi umum, bukan profesional tenaga kesehatan)
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- Halaman ----------
export default function Page() {
  return (
    <main>
      <ChatbotSection />
    </main>
  );
}
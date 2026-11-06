// app/api/chat/route.js
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { message } = await request.json();

    // `message` harus berupa string
    if (typeof message !== 'string' || !message.trim()) {
      return NextResponse.json(
        { error: 'Pertanyaan tidak boleh kosong' },
        { status: 400 }
      );
    }

    const baseUrl = process.env.FASTAPI_BASE_URL;
    if (!baseUrl) {
      console.error('FASTAPI_BASE_URL belum diatur di .env');
      return NextResponse.json(
        { error: 'Layanan chatbot belum dikonfigurasi.' },
        { status: 500 }
      );
    }

    const upstream = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: message.trim() }),
      cache: 'no-store',
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      console.error(`FastAPI error ${upstream.status}:`, detail);
      return NextResponse.json(
        { error: 'Layanan chatbot sedang bermasalah.' },
        { status: upstream.status === 429 ? 429 : 502 }
      );
    }

    const data = await upstream.json();

    // Sesuaikan nama field dengan respons FastAPI kamu
    const reply = data.reply ?? data.answer ?? data.response ?? data.message ?? '';

    return NextResponse.json({ reply });
  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: 'Layanan chatbot belum dapat dihubungi.' },
      { status: 500 }
    );
  }
}
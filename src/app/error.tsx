"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-display text-4xl leading-tight text-cobalt">No pudimos cargar la carta</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        Hubo un problema de nuestro lado. Revisá tu conexión e intentá de nuevo.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-8 self-start rounded-md bg-cobalt px-5 py-3 text-base font-semibold text-white"
      >
        Reintentar
      </button>
    </main>
  );
}

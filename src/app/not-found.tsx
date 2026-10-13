export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-4 py-16">
      <h1 className="font-display text-4xl leading-tight text-cobalt">No encontramos esta carta</h1>
      <p className="mt-4 text-lg leading-relaxed text-muted">
        El enlace puede estar incompleto o el local ya no la publica. Probá escaneando de nuevo el código QR de tu mesa.
      </p>
    </main>
  );
}

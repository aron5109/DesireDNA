"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-5 py-20 text-center">
      <section className="card p-8" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1 className="mt-3 text-3xl font-semibold">Your private data was not displayed.</h1>
        <p className="mt-4 text-muted">Try the request again. Sensitive error details are never shown here.</p>
        <button className="btn btn-primary mt-7" onClick={reset}>Try again</button>
      </section>
    </main>
  );
}

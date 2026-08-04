"use client";

import { useEffect, useState } from "react";
import { auth, provider, isFirebaseConfigured } from "@/lib/firebase-client";
import { signInWithPopup, signOut } from "firebase/auth";

type CreatePuzzleResponse = {
  puzzleId: string;
  date: string;
  puzzleNumber: number;
};

type ApiError = {
  error: string;
};

const normalizeArrayText = (text: string) =>
  text
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export default function AdminPage() {
  const [user, setUser] = useState(auth.currentUser);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [answer, setAnswer] = useState("");
  const [acceptedAnswers, setAcceptedAnswers] = useState("");
  const [category, setCategory] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteCount, setDeleteCount] = useState("");
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured) {
      setLoading(false);
      return;
    }

    const unsubscribe = auth.onAuthStateChanged(async (currentUser) => {
      setUser(currentUser);
      if (!currentUser) {
        setIsAdmin(null);
        setLoading(false);
        return;
      }

      try {
        const token = await currentUser.getIdToken();
        const response = await fetch("/api/admin/check", {
          method: "GET",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        setIsAdmin(response.ok);
      } catch {
        setIsAdmin(false);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const getToken = async () => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      throw new Error("User not signed in");
    }
    return currentUser.getIdToken();
  };

  const signIn = async () => {
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      setError("Failed to sign in. " + error);
    }
  };

  const signOutUser = async () => {
    await signOut(auth);
    setUser(null);
  };

  const submitPuzzle = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!imageFile) {
      setError("Please select an image file.");
      return;
    }

    try {
      const token = await getToken();
      const body = new FormData();
      body.append("image", imageFile);
      body.append("answer", answer.trim());
      body.append(
        "acceptedAnswers",
        JSON.stringify(normalizeArrayText(acceptedAnswers)),
      );
      body.append("category", category.trim());

      const response = await fetch("/api/admin/create-puzzle", {
        method: "POST",
        body,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = (await response.json()) as CreatePuzzleResponse | ApiError;
      if (!response.ok) {
        setError((data as ApiError).error ?? "Failed to create puzzle.");
        return;
      }

      const payload = data as CreatePuzzleResponse;
      setResult(
        `Scheduled for ${payload.date}, Puzzle #${payload.puzzleNumber}`,
      );
      setImageFile(null);
      setAnswer("");
      setAcceptedAnswers("");
      setCategory("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    }
  };

  const submitDelete = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDeleteResult(null);
    setError(null);

    const value = Number(deleteCount);
    if (!Number.isInteger(value) || value <= 0) {
      setError("Delete count must be a positive integer.");
      return;
    }

    try {
      const token = await getToken();
      const response = await fetch("/api/admin/delete-oldest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ count: value }),
      });

      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Failed to delete puzzles.");
        return;
      }

      setDeleteResult(data.message ?? "Deleted puzzles successfully.");
      setDeleteCount("");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
    }
  };

  if (!isFirebaseConfigured) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="prose">
          <h1>Admin form</h1>
          <p>
            Firebase client configuration is missing. Please set the required
            <code> NEXT_PUBLIC_FIREBASE_* </code> environment variables.
          </p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <p>Loading...</p>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-xl w-full rounded-2xl border border-slate-200 p-8 shadow-lg">
          <h1 className="text-2xl font-semibold mb-4">Admin Sign In</h1>
          <p className="mb-6">
            Sign in with your Firebase admin account to access the puzzle
            creator.
          </p>
          <button
            type="button"
            onClick={signIn}
            className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
          >
            Sign in with Google
          </button>
          {error ? <p className="mt-4 text-red-600">{error}</p> : null}
        </div>
      </main>
    );
  }

  if (isAdmin === false) {
    return (
      <main className="min-h-screen flex items-center justify-center p-8">
        <div className="max-w-xl w-full rounded-2xl border border-slate-200 p-8 shadow-lg">
          <h1 className="text-2xl font-semibold mb-4">Access Denied</h1>
          <p className="mb-6 text-slate-700">
            Your account is not authorized to access the admin panel.
          </p>
          <button
            type="button"
            onClick={signOutUser}
            className="rounded-md bg-slate-900 px-4 py-2 text-white hover:bg-slate-700"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="rounded-3xl bg-white p-8 shadow-lg">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-3xl font-semibold">Blurred Admin</h1>
              <p className="mt-2 text-sm text-slate-600">
                Create puzzles and delete oldest images from storage.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <p className="text-sm text-slate-700">
                Signed in as {user.email}
              </p>
              <button
                type="button"
                onClick={signOutUser}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-3xl bg-white p-8 shadow-lg">
          <h2 className="text-2xl font-semibold mb-4">Create new puzzle</h2>
          <form onSubmit={submitPuzzle} className="space-y-6">
            <label className="block space-y-2">
              <span className="font-medium">Puzzle image</span>
              <input
                type="file"
                accept="image/*"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  setImageFile(file);
                }}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
              />
            </label>
            <label className="block space-y-2">
              <span className="font-medium">Answer</span>
              <input
                type="text"
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                placeholder="Eiffel Tower"
                required
              />
            </label>
            <label className="block space-y-2">
              <span className="font-medium">Accepted answer variants</span>
              <textarea
                value={acceptedAnswers}
                onChange={(event) => setAcceptedAnswers(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                placeholder="the eiffel tower, tour eiffel"
                rows={4}
              />
              <p className="text-sm text-slate-500">
                Use commas or new lines to separate variants.
              </p>
            </label>
            <label className="block space-y-2">
              <span className="font-medium">Category (optional)</span>
              <input
                type="text"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                placeholder="landmark"
              />
            </label>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="submit"
                className="rounded-md bg-slate-900 px-5 py-3 text-white hover:bg-slate-700"
              >
                Create puzzle
              </button>
              <p className="text-sm text-slate-500">
                Upload generates all blur variants server-side.
              </p>
            </div>
          </form>
          {result ? <p className="mt-4 text-green-700">{result}</p> : null}
        </section>

        <section className="rounded-3xl bg-white p-8 shadow-lg">
          <h2 className="text-2xl font-semibold mb-4">Delete oldest puzzles</h2>
          <form onSubmit={submitDelete} className="space-y-4">
            <label className="block space-y-2">
              <span className="font-medium">Number to delete</span>
              <input
                type="number"
                min={1}
                value={deleteCount}
                onChange={(event) => setDeleteCount(event.target.value)}
                className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                placeholder="50"
              />
            </label>
            <button
              type="submit"
              className="rounded-md bg-red-600 px-5 py-3 text-white hover:bg-red-500"
            >
              Delete oldest puzzles
            </button>
          </form>
          {deleteResult ? (
            <p className="mt-4 text-green-700">{deleteResult}</p>
          ) : null}
          {error ? <p className="mt-4 text-red-600">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}

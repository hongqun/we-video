"use client";

import {FormEvent, useEffect, useState} from "react";
import {Icon} from "@/components/Icon";

export default function LoginPage() {
  const [profile, setProfile] = useState<{workspaceName: string} | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetch("/api/profile", {cache: "no-store"})
      .then((response) => response.json() as Promise<{workspaceName?: string}>)
      .then((value) => { if (value.workspaceName) setProfile({workspaceName: value.workspaceName}); })
      .catch(() => undefined);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({password}),
      });
      const body = await response.json() as {error?: string};
      if (!response.ok) throw new Error(body.error ?? "登录失败");
      // 硬跳转：必然带上刚写入的 session cookie，避开 App Router 软导航/缓存导致跳不过去的问题。
      window.location.replace("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "登录失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={submit}>
        <p className="login-eyebrow section-kicker">{profile?.workspaceName ?? "TECH123 / VIDEO STUDIO"}</p>
        <h1>登录工作台</h1>
        <p className="login-hint">使用应用密码进入视频创作平台。</p>
        <label>
          应用密码
          <input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error ? <p className="login-error" role="alert">{error}</p> : null}
        <button className="icon-label" disabled={busy || !password} type="submit">
          <Icon name="shield" />
          {busy ? "登录中…" : "进入工作台"}
        </button>
      </form>
    </main>
  );
}

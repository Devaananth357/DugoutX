"use client";

import { useRouter } from "next/navigation";

export function PlayNowButton() {
  const router = useRouter();
  function enterGame() {
    const signedUp = window.localStorage.getItem("dugoutx_user");
    router.push(signedUp ? "/seasons" : "/account");
  }
  return <button className="play-button" type="button" onClick={enterGame}>Play now <span>↗</span></button>;
}

"use client";
import { useEffect } from "react";
import { track } from "./store";

/** Sends one analytics event when a server-rendered screen is shown. */
export function TrackView({ event }: { event: string }) {
  useEffect(() => track(event), [event]);
  return null;
}

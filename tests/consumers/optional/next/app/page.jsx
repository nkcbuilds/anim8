"use client";

import { Anim8Player } from "@anim8/react";

const scene = {
  version: "1.0",
  scene: { width: 320, height: 180, theme: "clean" },
  objects: [],
  timeline: [],
};

export default function Page() {
  return (
    <main>
      <h1>Anim8 Next consumer fixture</h1>
      <Anim8Player scene={scene} aria-label="Anim8 fixture" />
    </main>
  );
}

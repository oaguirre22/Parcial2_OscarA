import * as dat from "dat.gui";

export const params = {
  ambient: 0.2,
  shininess: 32,
  mode: 1, // 0 = Phong, 1 = Blinn
};

export function initGUI() {
  const gui = new dat.GUI();

  gui.add(params, "ambient", 0, 1, 0.01);
  gui.add(params, "shininess", 1, 128, 1);
  gui.add(params, "mode", { Phong: 0, Blinn: 1 });

  return gui;
}
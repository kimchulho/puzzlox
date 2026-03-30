import * as PIXI from 'pixi.js';
async function test() {
  const app = new PIXI.Application();
  await app.init();
  const g = new PIXI.Graphics();
  g.rect(0, 0, 100, 100).fill(0xff0000);
  const tex = app.renderer.generateTexture(g);
  console.log(tex);
}
test();

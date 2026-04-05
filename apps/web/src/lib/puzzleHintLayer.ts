import * as PIXI from "pixi.js";
import type { PuzzleDifficulty } from "./puzzleDifficulty";

interface HintLayerOptions {
  renderer: any;
  world: PIXI.Container;
  texture: PIXI.Texture;
  boardStartX: number;
  boardStartY: number;
  boardWidth: number;
  boardHeight: number;
  pieceWidth: number;
  pieceHeight: number;
  difficulty: PuzzleDifficulty;
}

export interface PuzzleHintLayer {
  revealPiece: (pieceId: number, cols: number, rows: number) => void;
  revealPieces: (pieceIds: Iterable<number>, cols: number, rows: number) => void;
  destroy: () => void;
}

export const createPuzzleHintLayer = (opts: HintLayerOptions): PuzzleHintLayer => {
  const {
    renderer,
    world,
    texture,
    boardStartX,
    boardStartY,
    boardWidth,
    boardHeight,
    pieceWidth,
    pieceHeight,
    difficulty,
  } = opts;

  if (difficulty === "hard") {
    return {
      revealPiece: () => {},
      revealPieces: () => {},
      destroy: () => {},
    };
  }

  const hintSprite = new PIXI.Sprite(texture);
  hintSprite.x = boardStartX;
  hintSprite.y = boardStartY;
  hintSprite.width = boardWidth;
  hintSprite.height = boardHeight;
  hintSprite.alpha = 0.2;
  hintSprite.eventMode = "none";
  hintSprite.zIndex = -0.5;
  if (difficulty === "easy") {
    world.addChild(hintSprite);
    return {
      revealPiece: () => {},
      revealPieces: () => {},
      destroy: () => hintSprite.destroy(),
    };
  }

  // Medium: true blur based edge feathering.
  // Binary mask -> blurred mask -> compose source*mask into output RT.
  const revealW = Math.max(8, pieceWidth * 2);
  const revealH = Math.max(8, pieceHeight * 2);
  const corner = Math.max(4, Math.min(pieceWidth, pieceHeight) * 0.22);
  const rotationRad = 0;
  const rtW = Math.max(1, Math.ceil(boardWidth));
  const rtH = Math.max(1, Math.ceil(boardHeight));

  const maskRT = PIXI.RenderTexture.create({ width: rtW, height: rtH });
  const maskBlurRT = PIXI.RenderTexture.create({ width: rtW, height: rtH });
  const outputRT = PIXI.RenderTexture.create({ width: rtW, height: rtH });

  const sourceSprite = new PIXI.Sprite(texture);
  sourceSprite.x = 0;
  sourceSprite.y = 0;
  sourceSprite.width = boardWidth;
  sourceSprite.height = boardHeight;
  sourceSprite.alpha = 0.2;
  sourceSprite.eventMode = "none";

  const maskSprite = new PIXI.Sprite(maskBlurRT);
  maskSprite.x = 0;
  maskSprite.y = 0;
  maskSprite.width = boardWidth;
  maskSprite.height = boardHeight;
  maskSprite.eventMode = "none";

  const composeContainer = new PIXI.Container();
  composeContainer.addChild(sourceSprite);
  composeContainer.addChild(maskSprite);
  sourceSprite.mask = maskSprite;

  const blurInputSprite = new PIXI.Sprite(maskRT);
  blurInputSprite.x = 0;
  blurInputSprite.y = 0;
  blurInputSprite.width = boardWidth;
  blurInputSprite.height = boardHeight;
  blurInputSprite.filters = [new PIXI.BlurFilter({ strength: 10, quality: 2 })];
  blurInputSprite.filterArea = new PIXI.Rectangle(0, 0, boardWidth, boardHeight);

  const outputSprite = new PIXI.Sprite(outputRT);
  outputSprite.x = boardStartX;
  outputSprite.y = boardStartY;
  outputSprite.width = boardWidth;
  outputSprite.height = boardHeight;
  outputSprite.eventMode = "none";
  outputSprite.zIndex = -0.45;
  world.addChild(outputSprite);

  const renderDisplayInto = (displayObject: PIXI.DisplayObject, target: PIXI.RenderTexture, clear: boolean) => {
    renderer.render({ container: displayObject as any, target, clear });
  };
  const renderContainerInto = (container: PIXI.Container, target: PIXI.RenderTexture, clear: boolean) => {
    renderer.render({ container, target, clear });
  };
  const refreshOutput = () => {
    renderDisplayInto(blurInputSprite, maskBlurRT, true);
    renderContainerInto(composeContainer, outputRT, true);
  };
  refreshOutput();

  const revealPiece = (pieceId: number, cols: number, rows: number) => {
    if (pieceId < 0 || pieceId >= cols * rows) return;
    const col = pieceId % cols;
    const row = Math.floor(pieceId / cols);
    const cx = col * pieceWidth + pieceWidth / 2;
    const cy = row * pieceHeight + pieceHeight / 2;
    const patch = new PIXI.Graphics();
    patch.roundRect(-revealW / 2, -revealH / 2, revealW, revealH, corner).fill({ color: 0xffffff, alpha: 1 });
    patch.x = cx;
    patch.y = cy;
    patch.rotation = rotationRad;
    patch.eventMode = "none";
    renderDisplayInto(patch, maskRT, false);
    patch.destroy();
    refreshOutput();
  };

  return {
    revealPiece,
    revealPieces: (pieceIds, cols, rows) => {
      for (const id of pieceIds) revealPiece(id, cols, rows);
    },
    destroy: () => {
      composeContainer.destroy({ children: true });
      blurInputSprite.destroy();
      outputSprite.destroy();
      maskRT.destroy(true);
      maskBlurRT.destroy(true);
      outputRT.destroy(true);
      hintSprite.destroy();
    },
  };
};

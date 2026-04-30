import { Assets, Container, Sprite } from "pixi.js";

const CLOUD_ALIASES = [
	"cloud1",
	"cloud2",
	"cloud3",
	"cloud4",
	"cloud5",
	"cloud6",
] as const;

/** Mid-air clouds between sky (backgroundLayer) and terrain (worldLayer). */
export const buildCloudBackdrop = (
	worldW: number,
	groundY: number,
): Container => {
	const layer = new Container();
	const bandTop = groundY * 0.06;
	const bandH = groundY * 0.22;
	const count = 34;
	for (let i = 0; i < count; i += 1) {
		const alias = CLOUD_ALIASES[i % CLOUD_ALIASES.length]!;
		const sprite = new Sprite(Assets.get(alias));
		sprite.anchor.set(0.5);
		sprite.x = Math.random() * (worldW + 800) - 400;
		sprite.y = bandTop + Math.random() * bandH;
		const scale = 0.35 + Math.random() * 0.85;
		sprite.scale.set(scale);
		sprite.alpha = 0.3 + Math.random() * 0.4;
		layer.addChild(sprite);
	}
	return layer;
};

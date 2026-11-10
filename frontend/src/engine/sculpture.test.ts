import { describe, expect, it } from "vitest";
import { SculptureData, SPACING } from "./sculpture";

function line(data: SculptureData, length: number) {
  data.begin("red");
  data.add(0, 0, 0);
  data.add(length, 0, 0);
  data.end();
}

describe("SculptureData", () => {
  it("fills a stroke with evenly spaced points", () => {
    const data = new SculptureData();
    line(data, 1);
    expect(data.strokes).toHaveLength(1);
    expect(data.count).toBe(1 + Math.floor(1 / SPACING));
    expect(data.points[3]).toBeCloseTo(SPACING);
  });

  it("does not add points when the pen stands still", () => {
    const data = new SculptureData();
    data.begin("gold");
    data.add(1, 1, 1);
    expect(data.add(1, 1, 1.001)).toBe(0);
    expect(data.count).toBe(1);
  });

  it("drops a stroke that is only a dot", () => {
    const data = new SculptureData();
    data.begin("blue");
    data.add(0, 0, 0);
    data.end();
    expect(data.strokes).toHaveLength(0);
    expect(data.count).toBe(0);
  });

  it("starts a new stroke after a tracking jump", () => {
    const data = new SculptureData();
    data.begin("green");
    data.add(0, 0, 0);
    data.add(0.3, 0, 0);
    data.add(5, 0, 0);
    data.add(5.3, 0, 0);
    data.end();
    expect(data.strokes.map((s) => s.color)).toEqual(["green", "green"]);
  });

  it("undo removes the last stroke, clear removes all", () => {
    const data = new SculptureData();
    line(data, 1);
    const afterFirst = data.count;
    line(data, 2);
    expect(data.undo()).toBe(true);
    expect(data.count).toBe(afterFirst);
    data.clear();
    expect(data.count).toBe(0);
    expect(data.undo()).toBe(false);
  });

  it("survives a trip through JSON", () => {
    const data = new SculptureData();
    data.begin("rainbow");
    data.add(0, 0, 0);
    data.add(0, 0.5, 0.5);
    data.end();
    line(data, 0.5);
    const json = JSON.parse(JSON.stringify(data.toJSON()));
    expect(json.version).toBe(1);
    expect(json.strokes.map((s: { color: string }) => s.color)).toEqual(["rainbow", "red"]);
    const back = SculptureData.fromJSON(json);
    expect(back.count).toBe(data.count);
    expect(back.strokes.map((s) => s.count)).toEqual(data.strokes.map((s) => s.count));
    expect(back.points[back.count * 3 - 3]).toBeCloseTo(data.points[data.count * 3 - 3], 3);
  });
});

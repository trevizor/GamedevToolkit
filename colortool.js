let colors = [];

function parseColors() {
  let text = document.getElementById("input").value;
  text = text.replace(/\n|\r/g, "");

  const regex = /R" value="([\d.]+)".*?G" value="([\d.]+)".*?B" value="([\d.]+)"/g;
  
  colors = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    colors.push({
      r: parseFloat(match[1]),
      g: parseFloat(match[2]),
      b: parseFloat(match[3])
    });
  }

  render();
}

function render() {
  const container = document.getElementById("colors");
  container.innerHTML = "";

  colors.forEach(c => {
    const div = document.createElement("div");
    div.className = "color-box";
    div.style.backgroundColor = `rgb(${c.r*255}, ${c.g*255}, ${c.b*255})`;
    container.appendChild(div);
  });
}

function rgbToHslFull(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return { h, s, l };
}

function hslToRgb(h, s, l) {
  let r, g, b;

  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };

    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;

    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }

  return { r, g, b };
}

function adjustSaturation(amount) {
  colors = colors.map(c => {
    let { h, s, l } = rgbToHslFull(c.r, c.g, c.b);
    s = Math.min(1, Math.max(0, s + amount));
    return hslToRgb(h, s, l);
  });

  render();
  exportXML();
}

function adjustBrightness(amount) {
  colors = colors.map(c => {
    let { h, s, l } = rgbToHslFull(c.r, c.g, c.b);
    l = Math.min(1, Math.max(0, l + amount));
    return hslToRgb(h, s, l);
  });

  render();
  exportXML();
}

function rgbToHue(r, g, b) {
  return rgbToHslFull(r, g, b).h;
}

function sortHue() {
  colors.sort((a, b) => rgbToHue(a.r, a.g, a.b) - rgbToHue(b.r, b.g, b.b));
  render();
}

function exportXML() {
  let xml = "";

  colors.forEach(c => {
    xml += `<Property name="Colours"><Property name="R" value="${c.r.toFixed(2)}"/><Property name="G" value="${c.g.toFixed(2)}"/><Property name="B" value="${c.b.toFixed(2)}"/><Property name="A" value="1.0"/></Property>\n`;
  });

  document.getElementById("output").value = xml;
}

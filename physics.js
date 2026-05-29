(function () {
  'use strict';

  const { Engine, Runner, Bodies, Body, Composite, Constraint, Events } = Matter;

  const IS_MOBILE     = window.innerWidth <= 768 || ('ontouchstart' in window);
  const MOBILE_SCALE  = 0.936;

  // --- Canvas overlay ---
  const canvas = document.createElement('canvas');
  canvas.style.cssText = [
    'position:fixed', 'top:0', 'left:0',
    'width:100vw', 'height:100vh',
    'pointer-events:none', 'z-index:100',
  ].join(';');
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // --- Textures ---
  // Replace PNGs in textures/ with your artwork. Falls back to grey shapes until loaded.
  const TEX = {};
  ['head','chest','midTorso','pelvis',
   'upperArmL','upperArmR','lowerArmL','lowerArmR','handL','handR',
   'upperLegL','upperLegR','lowerLegL','lowerLegR',
  ].forEach(function (name) {
    const img = new Image();
    img.src = 'textures/' + name + '.png';
    TEX[name] = img;
  });

  // --- Physics engine ---
  const engine = Engine.create({ gravity: { y: 1.5 } });
  const runner  = Runner.create();
  Runner.run(runner, engine);

  // --- Puppet defaults ---
  // dx/dy = offset of part center from spawn reference point (cx0, sy0)
  const PUPPET_DEFAULTS = {
    head:      { w: 55,  h:  60, dx:   0,  dy:   30   },
    chest:     { w: 70,  h:  72, dx:   0,  dy:   96   },
    midTorso:  { w: 65,  h:  55, dx:   0,  dy:  159.5 },
    pelvis:    { w: 68,  h:  60, dx:   0,  dy:  217   },
    upperArmL: { w: 28,  h: 100, dx: -51,  dy:  110   },
    upperArmR: { w: 28,  h: 100, dx:  51,  dy:  110   },
    lowerArmL: { w: 22,  h:  85, dx: -51,  dy: 202.5  },
    lowerArmR: { w: 22,  h:  85, dx:  51,  dy: 202.5  },
    handL:     { w: 30,  h:  22, dx: -51,  dy:  256   },
    handR:     { w: 30,  h:  22, dx:  51,  dy:  256   },
    upperLegL: { w: 32,  h: 115, dx: -18,  dy: 304.5  },
    upperLegR: { w: 32,  h: 115, dx:  18,  dy: 304.5  },
    lowerLegL: { w: 28,  h: 100, dx: -18,  dy:  412   },
    lowerLegR: { w: 28,  h: 100, dx:  18,  dy:  412   },
  };

  // Puppet parts don't collide with each other by default
  const PUPPET_FILTER    = { category: 0x0002, mask: 0x0001 };
  // Lower legs collide with page (0x0001) + each other (0x0020)
  const LOWER_LEG_FILTER = { category: 0x0020, mask: 0x0001 | 0x0020 };

  // --- Puppet state (populated by buildPuppet) ---
  let puppetLayout = null;
  let head, chest, midTorso, pelvis;
  let upperArmL, upperArmR, lowerArmL, lowerArmR;
  let handL, handR;
  let upperLegL, upperLegR, lowerLegL, lowerLegR;
  let puppetParts   = [];
  let angularLimits = [];

  function makePart(x, y, w, h, extra) {
    const b = Bodies.rectangle(x, y, w, h, Object.assign({
      restitution: 0.3, friction: 0.05, frictionAir: 0.035,
      label: 'puppet', collisionFilter: PUPPET_FILTER,
    }, extra || {}));
    b.hw = w / 2;
    b.hh = h / 2;
    return b;
  }

  // y-offset for shoulder joint on chest: arm-top (+15px) relative to chest center, clamped to chest bounds.
  // Matches the formula in puppet_editor.html so the visual and physics stay in sync.
  function shoulderY(lay, armName) {
    const rel = (lay[armName].dy - lay[armName].h / 2 + 15) - lay.chest.dy;
    return Math.max(-lay.chest.h / 2, Math.min(lay.chest.h / 2, rel));
  }

  const DEFAULT_DRAW_ORDER = [
    'lowerLegL','lowerLegR',
    'lowerArmL','lowerArmR','handL','handR',
    'upperLegL','upperLegR','upperArmL','upperArmR',
    'pelvis','midTorso','chest','head',
  ];

  function buildPuppet(cfg) {
    // Merge saved config with defaults (saved values take priority), then scale for mobile
    const S = IS_MOBILE ? MOBILE_SCALE : 1;
    const lay = {};
    Object.keys(PUPPET_DEFAULTS).forEach(function (name) {
      const m = Object.assign({}, PUPPET_DEFAULTS[name], cfg && cfg.parts && cfg.parts[name]);
      lay[name] = S === 1 ? m : { w: m.w * S, h: m.h * S, dx: m.dx * S, dy: m.dy * S };
    });

    // Draw order from config, falling back to default
    const cfgOrder = cfg && cfg.drawOrder;
    lay.drawOrder = (Array.isArray(cfgOrder) && cfgOrder.length)
      ? cfgOrder.filter(function (n) { return PUPPET_DEFAULTS[n]; })
      : DEFAULT_DRAW_ORDER.slice();

    // Resolve a joint attachment point: use saved override if present, else default
    const jcfg = (cfg && cfg.joints) || {};
    function jpt(id, ep, x, y) {
      const ov = jcfg[id];
      return (ov && ov[ep]) ? { x: ov[ep][0] * S, y: ov[ep][1] * S } : { x: x, y: y };
    }

    // Store resolved joint attachment points for drawPuppet
    lay.J = {
      neck:       { pA: jpt('neck','pA',       0,                                  lay.head.h/2),
                    pB: jpt('neck','pB',       0,                                 -lay.chest.h/2) },
      upperWaist: { pA: jpt('upperWaist','pA', 0,                                  lay.chest.h/2),
                    pB: jpt('upperWaist','pB', 0,                                 -lay.midTorso.h/2) },
      lowerWaist: { pA: jpt('lowerWaist','pA', 0,                                  lay.midTorso.h/2),
                    pB: jpt('lowerWaist','pB', 0,                                 -lay.pelvis.h/2) },
      shoulderL:  { pA: jpt('shoulderL','pA', -lay.chest.w/2,                      shoulderY(lay,'upperArmL')),
                    pB: jpt('shoulderL','pB',  0,                                 -lay.upperArmL.h/2) },
      shoulderR:  { pA: jpt('shoulderR','pA',  lay.chest.w/2,                      shoulderY(lay,'upperArmR')),
                    pB: jpt('shoulderR','pB',  0,                                 -lay.upperArmR.h/2) },
      elbowL:     { pA: jpt('elbowL','pA',    0,                                   lay.upperArmL.h/2),
                    pB: jpt('elbowL','pB',    0,                                  -lay.lowerArmL.h/2) },
      elbowR:     { pA: jpt('elbowR','pA',    0,                                   lay.upperArmR.h/2),
                    pB: jpt('elbowR','pB',    0,                                  -lay.lowerArmR.h/2) },
      wristL:     { pA: jpt('wristL','pA',    0,                                   lay.lowerArmL.h/2),
                    pB: jpt('wristL','pB',    0,                                  -lay.handL.h/2) },
      wristR:     { pA: jpt('wristR','pA',    0,                                   lay.lowerArmR.h/2),
                    pB: jpt('wristR','pB',    0,                                  -lay.handR.h/2) },
      hipL:       { pA: jpt('hipL','pA',      lay.upperLegL.dx - lay.pelvis.dx,    lay.pelvis.h/2),
                    pB: jpt('hipL','pB',      0,                                  -lay.upperLegL.h/2) },
      hipR:       { pA: jpt('hipR','pA',      lay.upperLegR.dx - lay.pelvis.dx,    lay.pelvis.h/2),
                    pB: jpt('hipR','pB',      0,                                  -lay.upperLegR.h/2) },
      kneeL:      { pA: jpt('kneeL','pA',    0,                                    lay.upperLegL.h/2),
                    pB: jpt('kneeL','pB',    0,                                   -lay.lowerLegL.h/2) },
      kneeR:      { pA: jpt('kneeR','pA',    0,                                    lay.upperLegR.h/2),
                    pB: jpt('kneeR','pB',    0,                                   -lay.lowerLegR.h/2) },
    };
    puppetLayout = lay;

    const cx0 = window.innerWidth * 0.72, sy0 = 20;

    function make(name, extra) {
      const p = lay[name];
      return makePart(cx0 + p.dx, sy0 + p.dy, p.w, p.h, extra);
    }

    head      = make('head',     { frictionAir: 0.04 });
    chest     = make('chest',    { density: 0.004 });
    midTorso  = make('midTorso', { density: 0.003 });
    pelvis    = make('pelvis',   { density: 0.003 });
    upperArmL = make('upperArmL');
    upperArmR = make('upperArmR');
    lowerArmL = make('lowerArmL');
    lowerArmR = make('lowerArmR');
    handL     = make('handL');
    handR     = make('handR');
    upperLegL = make('upperLegL');
    upperLegR = make('upperLegR');
    lowerLegL = make('lowerLegL');
    lowerLegR = make('lowerLegR');

    puppetParts = [head, chest, midTorso, pelvis,
                   upperArmL, upperArmR, lowerArmL, lowerArmR, handL, handR,
                   upperLegL, upperLegR, lowerLegL, lowerLegR];

    function joint(bA, pA, bB, pB, stiffness) {
      return Constraint.create({
        bodyA: bA, pointA: pA, bodyB: bB, pointB: pB,
        stiffness: stiffness, damping: 0.05, length: 0,
      });
    }

    const J = lay.J;
    Composite.add(engine.world, puppetParts.concat([
      joint(head,      J.neck.pA,       chest,     J.neck.pB,       0.7),
      joint(chest,     J.upperWaist.pA, midTorso,  J.upperWaist.pB, 0.6),
      joint(midTorso,  J.lowerWaist.pA, pelvis,    J.lowerWaist.pB, 0.6),
      joint(chest,     J.shoulderL.pA,  upperArmL, J.shoulderL.pB,  0.7),
      joint(chest,     J.shoulderR.pA,  upperArmR, J.shoulderR.pB,  0.7),
      joint(upperArmL, J.elbowL.pA,     lowerArmL, J.elbowL.pB,     0.7),
      joint(upperArmR, J.elbowR.pA,     lowerArmR, J.elbowR.pB,     0.7),
      joint(lowerArmL, J.wristL.pA,     handL,     J.wristL.pB,     0.7),
      joint(lowerArmR, J.wristR.pA,     handR,     J.wristR.pB,     0.7),
      joint(pelvis,    J.hipL.pA,       upperLegL, J.hipL.pB,       0.7),
      joint(pelvis,    J.hipR.pA,       upperLegR, J.hipR.pB,       0.7),
      joint(upperLegL, J.kneeL.pA,      lowerLegL, J.kneeL.pB,      0.7),
      joint(upperLegR, J.kneeR.pA,      lowerLegR, J.kneeR.pB,      0.7),
    ]));

    // --- Angular limits ---
    angularLimits = [];
    function addLimit(bA, bB, min, max, k) {
      angularLimits.push({ bodyA: bA, bodyB: bB, min: min, max: max, k: k || 0.35 });
    }
    const DEG = Math.PI / 180;
    addLimit(chest,     head,        -40 * DEG,  40 * DEG, 0.32);  // neck
    addLimit(chest,     midTorso,    -10 * DEG,  10 * DEG, 0.28);  // upper waist
    addLimit(midTorso,  pelvis,      -10 * DEG,  10 * DEG, 0.28);  // lower waist
    addLimit(chest,     upperArmL,   -30 * DEG, 180 * DEG, 0.28);  // shoulder L
    addLimit(chest,     upperArmR,  -180 * DEG,  30 * DEG, 0.28);  // shoulder R
    addLimit(upperArmL, lowerArmL,   -10 * DEG, 120 * DEG, 0.22);  // elbow L
    addLimit(upperArmR, lowerArmR,   -10 * DEG, 120 * DEG, 0.22);  // elbow R
    addLimit(lowerArmL, handL,       -60 * DEG,  60 * DEG, 0.16);  // wrist L
    addLimit(lowerArmR, handR,       -60 * DEG,  60 * DEG, 0.16);  // wrist R
    addLimit(pelvis,    upperLegL,   -30 * DEG, 100 * DEG, 0.28);  // hip L
    addLimit(pelvis,    upperLegR,   -30 * DEG, 100 * DEG, 0.28);  // hip R
    addLimit(upperLegL, lowerLegL,   -10 * DEG, 140 * DEG, 0.18);  // knee L
    addLimit(upperLegR, lowerLegR,   -10 * DEG, 140 * DEG, 0.18);  // knee R
  }

  // --- Manual sleep ---
  // When all puppet parts are slow for SLEEP_FRAMES consecutive ticks,
  // zero their velocities and skip angular-limit corrections until woken.
  const SLEEP_V      = 0.5;   // px/tick linear speed threshold
  const SLEEP_W      = 0.01;  // rad/tick angular speed threshold
  const SLEEP_FRAMES = 25;    // ~0.4 s at 60 fps
  let puppetAsleep = false;
  let sleepFrames  = 0;

  Events.on(engine, 'beforeUpdate', function () {
    if (puppetAsleep) return;
    angularLimits.forEach(function (lim) {
      var rel = lim.bodyB.angle - lim.bodyA.angle;
      while (rel >  Math.PI) rel -= 2 * Math.PI;
      while (rel < -Math.PI) rel += 2 * Math.PI;

      if (rel > lim.max) {
        // Damp existing angular velocity while pushing back — prevents P-only oscillation
        Body.setAngularVelocity(lim.bodyB,
          lim.bodyB.angularVelocity * 0.8 - (rel - lim.max) * lim.k);
      } else if (rel < lim.min) {
        Body.setAngularVelocity(lim.bodyB,
          lim.bodyB.angularVelocity * 0.8 - (rel - lim.min) * lim.k);
      }
    });
  });

  Events.on(engine, 'afterUpdate', function () {
    if (anyDragging()) { puppetAsleep = false; sleepFrames = 0; return; }
    const resting = puppetParts.every(function (b) {
      return b.speed < SLEEP_V && Math.abs(b.angularVelocity) < SLEEP_W;
    });
    if (resting) {
      if (++sleepFrames >= SLEEP_FRAMES) {
        puppetAsleep = true;
        puppetParts.forEach(function (b) {
          Body.setVelocity(b, { x: 0, y: 0 });
          Body.setAngularVelocity(b, 0);
        });
      }
    } else {
      sleepFrames  = 0;
      puppetAsleep = false;
      scheduleFrame(); // physics became active — ensure render loop is running
    }
  });

  // --- Boundary walls (left + right only) ---
  function makeWalls(w, h) {
    const T = 60;
    const ws = [
      Bodies.rectangle(-T / 2,    h / 2, T, h + T * 2, { isStatic: true, label: 'wall' }),
      Bodies.rectangle(w + T / 2, h / 2, T, h + T * 2, { isStatic: true, label: 'wall' }),
    ];
    if (IS_MOBILE) {
      ws.push(
        Bodies.rectangle(w / 2, -T / 2,    w + T * 2, T, { isStatic: true, label: 'wall' }),
        Bodies.rectangle(w / 2, h + T / 2, w + T * 2, T, { isStatic: true, label: 'wall' }),
      );
    }
    return ws;
  }
  let walls = makeWalls(window.innerWidth, window.innerHeight);
  Composite.add(engine.world, walls);

  // --- Document-bottom wall (PC only) ---
  let docHeight = document.body.scrollHeight;
  let docBottomWall = null;
  if (!IS_MOBILE) {
    docBottomWall = Bodies.rectangle(
      window.innerWidth / 2, docHeight - window.scrollY + 30,
      window.innerWidth * 3, 60,
      { isStatic: true, label: 'doc-bottom' }
    );
    Composite.add(engine.world, docBottomWall);
  }

  // --- Page element collision bodies ---
  const PAGE_EL_SELECTOR = [
    'img.work-img', 'span.work-title', 'span.work-year',
    '.cv-name', '.cv-intro', '.cv-label', '.cv-entry',
    '.label-h1', '.label-h2', '.work-desc p', '.trilogy-text p',
  ].join(', ');

  let pageBodies = [];

  function getTextRects(el) {
    if (el.tagName === 'IMG') {
      const r = el.getBoundingClientRect();
      return r.width > 4 ? [r] : [];
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    return Array.from(range.getClientRects()).filter(function (r) {
      return r.width > 10 && r.height > 8;
    });
  }

  function initPageBodies() {
    pageBodies.forEach(function (item) { Composite.remove(engine.world, item.body); });
    pageBodies = [];
    document.querySelectorAll(PAGE_EL_SELECTOR).forEach(function (el) {
      getTextRects(el).forEach(function (rect) {
        const docX = rect.left + rect.width  / 2;
        const docY = rect.top  + rect.height / 2 + window.scrollY;
        const body = Bodies.rectangle(docX, docY - window.scrollY, rect.width, rect.height, {
          isStatic: true, label: 'page-el', friction: 0.4, restitution: 0.4,
        });
        Composite.add(engine.world, body);
        pageBodies.push({ docX: docX, docY: docY, body: body, culled: false });
      });
    });
  }

  function updatePageBodies() {
    if (IS_MOBILE) return;
    const scrollY = window.scrollY;
    Body.setPosition(docBottomWall, { x: window.innerWidth / 2, y: docHeight - scrollY + 30 });

    // Active zone: viewport ± padding, extended to fully contain the puppet.
    const PAD = 300;
    let zoneMin = -PAD;
    let zoneMax = window.innerHeight + PAD;
    puppetParts.forEach(function (b) {
      if (b.position.y - PAD < zoneMin) zoneMin = b.position.y - PAD;
      if (b.position.y + PAD > zoneMax) zoneMax = b.position.y + PAD;
    });

    pageBodies.forEach(function (item) {
      const vy = item.docY - scrollY;
      const inZone = (vy >= zoneMin && vy <= zoneMax);
      if (inZone) {
        item.culled = false;
        Body.setPosition(item.body, { x: item.docX, y: vy });
      } else if (!item.culled) {
        item.culled = true;
        Body.setPosition(item.body, { x: item.docX, y: -9999 });
      }
    });
  }

  // --- Drawing ---
  function getWorldPt(body, lx, ly) {
    const c = Math.cos(body.angle), s = Math.sin(body.angle);
    return {
      x: body.position.x + lx * c - ly * s,
      y: body.position.y + lx * s + ly * c,
    };
  }

  function drawPart(body, w, h, img, fallbackRadius) {
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);

    if (img && img.complete && img.naturalWidth > 0) {
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    } else {
      ctx.shadowColor   = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur    = 14;
      ctx.shadowOffsetY = 5;
      const grad = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      grad.addColorStop(0,    '#808080');
      grad.addColorStop(0.35, '#d0d0d0');
      grad.addColorStop(0.65, '#f0f0f0');
      grad.addColorStop(1,    '#909090');
      const r = fallbackRadius !== undefined ? fallbackRadius : 4;
      ctx.beginPath();
      if (ctx.roundRect) { ctx.roundRect(-w / 2, -h / 2, w, h, r); }
      else               { ctx.rect(-w / 2, -h / 2, w, h); }
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth   = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawJoint(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r || 8, 0, Math.PI * 2);
    ctx.fillStyle   = '#707070';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth   = 1;
    ctx.stroke();
  }

  function drawPuppet() {
    if (!puppetLayout) return;
    const lay = puppetLayout;

    // Draw parts in config draw order (back→front).
    // bodyMap maps part name → {body, fallbackRadius}
    const bodyMap = {
      head:      { body: head,      fr: lay.head.w / 2 },
      chest:     { body: chest,     fr: undefined },
      midTorso:  { body: midTorso,  fr: undefined },
      pelvis:    { body: pelvis,    fr: undefined },
      upperArmL: { body: upperArmL, fr: undefined },
      upperArmR: { body: upperArmR, fr: undefined },
      lowerArmL: { body: lowerArmL, fr: undefined },
      lowerArmR: { body: lowerArmR, fr: undefined },
      handL:     { body: handL,     fr: undefined },
      handR:     { body: handR,     fr: undefined },
      upperLegL: { body: upperLegL, fr: undefined },
      upperLegR: { body: upperLegR, fr: undefined },
      lowerLegL: { body: lowerLegL, fr: undefined },
      lowerLegR: { body: lowerLegR, fr: undefined },
    };

    lay.drawOrder.forEach(function (name) {
      const entry = bodyMap[name];
      if (!entry) return;
      const p = lay[name];
      drawPart(entry.body, p.w, p.h, TEX[name], entry.fr);
    });
  }

  // --- Render loop ---
  let lastDrawScrollY = window.scrollY;
  let rafActive = false;

  function scheduleFrame() {
    if (!rafActive) { rafActive = true; requestAnimationFrame(drawFrame); }
  }

  function drawFrame() {
    const scrollDelta = window.scrollY - lastDrawScrollY;
    lastDrawScrollY   = window.scrollY;
    if (!IS_MOBILE && scrollDelta !== 0 && !anyDragging()) {
      puppetParts.forEach(function (b) {
        Body.setPosition(b, { x: b.position.x, y: b.position.y - scrollDelta });
      });
    }

    updatePageBodies();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawPuppet();

    if (puppetAsleep && !anyDragging()) {
      rafActive = false; // pause until woken
    } else {
      requestAnimationFrame(drawFrame);
    }
  }
  scheduleFrame();

  // PC scroll shifts the puppet — restart loop so the position update renders
  if (!IS_MOBILE) window.addEventListener('scroll', scheduleFrame, { passive: true });

  // Restart after tab switch (browser pauses RAF while hidden)
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) scheduleFrame();
  });

  // --- Drag (multi-touch: one constraint per active pointer/touch) ---
  const dragConstraints = {};
  const mouseAnchors    = {};

  function anyDragging() { return Object.keys(dragConstraints).length > 0; }

  function pointInBody(px, py, body, grace) {
    const dx  = px - body.position.x,  dy  = py - body.position.y;
    const cos = Math.cos(-body.angle),  sin = Math.sin(-body.angle);
    const lx  = dx * cos - dy * sin,   ly  = dx * sin + dy * cos;
    return Math.abs(lx) <= body.hw + grace && Math.abs(ly) <= body.hh + grace;
  }

  function hitTest(px, py, isTouch) {
    const grace = isTouch ? 14 : 5;
    for (var i = 0; i < puppetParts.length; i++) {
      if (pointInBody(px, py, puppetParts[i], grace)) return puppetParts[i];
    }
    return null;
  }

  function startDrag(px, py, target, id) {
    puppetAsleep = false;
    sleepFrames  = 0;
    scheduleFrame();
    const anchor = Bodies.circle(px, py, 1, {
      isStatic: true, collisionFilter: { mask: 0 }, label: 'anchor',
    });
    Composite.add(engine.world, anchor);
    const constraint = Constraint.create({
      bodyA: target, bodyB: anchor,
      stiffness: 0.2, damping: 0.1, length: 0,
    });
    Composite.add(engine.world, constraint);
    dragConstraints[id] = constraint;
    mouseAnchors[id]    = anchor;
    document.body.style.userSelect = 'none';
  }

  function moveDrag(px, py, id) {
    const anchor = mouseAnchors[id];
    if (anchor) Body.setPosition(anchor, { x: px, y: py });
  }

  function endDrag(id) {
    const constraint = dragConstraints[id];
    const anchor     = mouseAnchors[id];
    if (constraint) { Composite.remove(engine.world, constraint); delete dragConstraints[id]; }
    if (anchor)     { Composite.remove(engine.world, anchor);     delete mouseAnchors[id]; }
    if (!anyDragging()) document.body.style.userSelect = '';
  }

  if ('ontouchstart' in window) {
    // Mobile: use native touch events so preventDefault() on touchstart reliably
    // stops the browser treating the gesture as a scroll before JS even runs.
    // (Calling preventDefault() on pointerdown is not enough on iOS Safari.)
    // Note: preventing default on touchstart suppresses the synthetic pointerdown,
    // so we must handle the full drag lifecycle with touch events here.
    document.addEventListener('touchstart', function (e) {
      var didHit = false;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t   = e.changedTouches[i];
        var hit = hitTest(t.clientX, t.clientY, true);
        if (hit) { startDrag(t.clientX, t.clientY, hit, t.identifier); didHit = true; }
      }
      if (didHit) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchmove', function (e) {
      var moved = false;
      for (var i = 0; i < e.changedTouches.length; i++) {
        var t = e.changedTouches[i];
        if (mouseAnchors[t.identifier]) { moveDrag(t.clientX, t.clientY, t.identifier); moved = true; }
      }
      if (moved) e.preventDefault();
    }, { passive: false });

    document.addEventListener('touchend', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) endDrag(e.changedTouches[i].identifier);
    });
    document.addEventListener('touchcancel', function (e) {
      for (var i = 0; i < e.changedTouches.length; i++) endDrag(e.changedTouches[i].identifier);
    });

  } else {
    // Desktop: pointer events work fine (no scroll conflict without touch).
    document.addEventListener('pointerdown', function (e) {
      const hit = hitTest(e.clientX, e.clientY, false);
      if (!hit) return;
      e.preventDefault();
      startDrag(e.clientX, e.clientY, hit, e.pointerId);
    }, { passive: false });

    document.addEventListener('pointermove', function (e) {
      if (!dragConstraints[e.pointerId]) return;
      moveDrag(e.clientX, e.clientY, e.pointerId);
      e.preventDefault();
    }, { passive: false });

    document.addEventListener('pointerup',     function (e) { endDrag(e.pointerId); });
    document.addEventListener('pointercancel', function (e) { endDrag(e.pointerId); });
  }

  // --- Spawn ---
  function spawnPuppet(cx, sy) {
    const lay = puppetLayout;
    Body.setPosition(head,      { x: cx + lay.head.dx,      y: sy + lay.head.dy      });
    Body.setPosition(chest,     { x: cx + lay.chest.dx,     y: sy + lay.chest.dy     });
    Body.setPosition(midTorso,  { x: cx + lay.midTorso.dx,  y: sy + lay.midTorso.dy  });
    Body.setPosition(pelvis,    { x: cx + lay.pelvis.dx,    y: sy + lay.pelvis.dy    });
    Body.setPosition(upperArmL, { x: cx + lay.upperArmL.dx, y: sy + lay.upperArmL.dy });
    Body.setPosition(upperArmR, { x: cx + lay.upperArmR.dx, y: sy + lay.upperArmR.dy });
    Body.setPosition(lowerArmL, { x: cx + lay.lowerArmL.dx, y: sy + lay.lowerArmL.dy });
    Body.setPosition(lowerArmR, { x: cx + lay.lowerArmR.dx, y: sy + lay.lowerArmR.dy });
    Body.setPosition(handL,     { x: cx + lay.handL.dx,     y: sy + lay.handL.dy     });
    Body.setPosition(handR,     { x: cx + lay.handR.dx,     y: sy + lay.handR.dy     });
    Body.setPosition(upperLegL, { x: cx + lay.upperLegL.dx, y: sy + lay.upperLegL.dy });
    Body.setPosition(upperLegR, { x: cx + lay.upperLegR.dx, y: sy + lay.upperLegR.dy });
    Body.setPosition(lowerLegL, { x: cx + lay.lowerLegL.dx, y: sy + lay.lowerLegL.dy });
    Body.setPosition(lowerLegR, { x: cx + lay.lowerLegR.dx, y: sy + lay.lowerLegR.dy });
    // Spawn lying on side (90° = π/2)
    puppetParts.forEach(function (b) {
      Body.setAngle(b, Math.PI *0.25);
      Body.setVelocity(b, { x: 0, y: 0 });
      Body.setAngularVelocity(b, 0);
    });
  }

  function onPageLoad() {
    if (!IS_MOBILE) initPageBodies();
    docHeight = document.body.scrollHeight;

    const doSpawn = function (cfg) {
      buildPuppet(cfg);
      const spawnCX = IS_MOBILE ? window.innerWidth / 2 : window.innerWidth-320;
      const spawnSY = IS_MOBILE ? 50 : 0;
      spawnPuppet(spawnCX, spawnSY);
    };

    fetch('puppet_config.json')
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) { doSpawn(cfg); })
      .catch(function ()   { doSpawn(null); });
  }

  if (document.readyState === 'complete') { onPageLoad(); }
  else { window.addEventListener('load', onPageLoad); }

  // --- Resize ---
  window.addEventListener('resize', function () {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
    walls.forEach(function (w) { Composite.remove(engine.world, w); });
    walls = makeWalls(window.innerWidth, window.innerHeight);
    Composite.add(engine.world, walls);
    docHeight = document.body.scrollHeight;
    if (!IS_MOBILE) initPageBodies();
  });

})();

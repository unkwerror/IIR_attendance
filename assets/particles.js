/**
 * Частицы для экранов приложения.
 * Не зацикленная анимация: частицы постоянно меняют направление и не возвращаются к исходной точке.
 * Использование: var controller = window.startParticles('canvas-id', 'slowChaotic');
 * controller.cancel() — остановить анимацию.
 */
(function () {
  'use strict';

  var MAX_VEL = 0.28;
  var NUDGE = 0.012;

  function getCanvas(canvasId) {
    var el = typeof canvasId === 'string' ? document.getElementById(canvasId) : canvasId;
    return el && el.getContext ? el : null;
  }

  function resizeCanvas(canvas) {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  /**
   * Медленные хаотичные частицы по всему экрану.
   * Без зацикливания: скорость плавно меняется каждый кадр (random walk), частицы обтекают края (wrap).
   */
  function runSlowChaotic(canvas, ctx) {
    var W = canvas.width;
    var H = canvas.height;
    var particles = [];
    var i;

    for (i = 0; i < 80; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.1,
        vy: (Math.random() - 0.5) * 0.1,
        size: 1 + Math.random() * 1.8,
        hue: '255,255,255',
        opacity: 0.25 + Math.random() * 0.15
      });
    }

    function draw() {
      if (!canvas.width || !canvas.height) {
        animId = requestAnimationFrame(draw);
        return;
      }
      W = canvas.width;
      H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.vx += (Math.random() - 0.5) * NUDGE;
        p.vy += (Math.random() - 0.5) * NUDGE;
        p.vx = Math.max(-MAX_VEL, Math.min(MAX_VEL, p.vx));
        p.vy = Math.max(-MAX_VEL, Math.min(MAX_VEL, p.vy));
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += W;
        if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H;
        if (p.y >= H) p.y -= H;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.hue + ',' + p.opacity.toFixed(2) + ')';
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    }

    var animId = requestAnimationFrame(draw);
    return function cancel() {
      cancelAnimationFrame(animId);
    };
  }

  /**
   * Студент: частицы по всему экрану, быстрее, обтекание краёв, постоянная смена направления.
   */
  function runStudent(canvas, ctx) {
    var W = canvas.width;
    var H = canvas.height;
    var particles = [];
    var i;
    for (i = 0; i < 100; i++) {
      particles.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        size: 1 + Math.random() * 2,
        hue: '255,255,255',
        opacity: 0.5 + Math.random() * 0.3
      });
    }

    function draw() {
      if (!canvas.width || !canvas.height) {
        animId = requestAnimationFrame(draw);
        return;
      }
      W = canvas.width;
      H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.vx += (Math.random() - 0.5) * 0.02;
        p.vy += (Math.random() - 0.5) * 0.02;
        p.vx = Math.max(-0.6, Math.min(0.6, p.vx));
        p.vy = Math.max(-0.6, Math.min(0.6, p.vy));
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += W;
        if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H;
        if (p.y >= H) p.y -= H;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.hue + ',' + p.opacity.toFixed(2) + ')';
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    }

    var animId = requestAnimationFrame(draw);
    return function cancel() {
      cancelAnimationFrame(animId);
    };
  }

  /**
   * Сплэш: старт из центра (разлёт), далее частицы летят без зацикливания, обтекание краёв и смена направления.
   */
  function runSplash(canvas, ctx) {
    var W = canvas.width;
    var H = canvas.height;
    var cx = W * 0.5;
    var cy = H * 0.5;
    var particles = [];
    var i;

    for (i = 0; i < 120; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = 0.35 + Math.random() * 1.2;
      particles.push({
        x: cx + (Math.random() - 0.5) * 50,
        y: cy + (Math.random() - 0.5) * 50,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        size: 1 + Math.random() * 2.2,
        hue: '255,255,255',
        opacity: 0.7 + Math.random() * 0.2
      });
    }

    function draw() {
      if (!canvas.width || !canvas.height) {
        animId = requestAnimationFrame(draw);
        return;
      }
      W = canvas.width;
      H = canvas.height;
      ctx.clearRect(0, 0, W, H);

      for (i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.vx += (Math.random() - 0.5) * 0.008;
        p.vy += (Math.random() - 0.5) * 0.008;
        p.vx = Math.max(-1.2, Math.min(1.2, p.vx));
        p.vy = Math.max(-1.2, Math.min(1.2, p.vy));
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0) p.x += W;
        if (p.x >= W) p.x -= W;
        if (p.y < 0) p.y += H;
        if (p.y >= H) p.y -= H;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.hue + ',' + p.opacity.toFixed(2) + ')';
        ctx.fill();
      }
      animId = requestAnimationFrame(draw);
    }

    var animId = requestAnimationFrame(draw);
    return function cancel() {
      cancelAnimationFrame(animId);
    };
  }

  function startParticles(canvasId, preset) {
    var canvas = getCanvas(canvasId);
    if (!canvas) return { cancel: function () {} };

    resizeCanvas(canvas);
    var resizeHandler = function () {
      resizeCanvas(canvas);
    };
    window.addEventListener('resize', resizeHandler);

    var ctx = canvas.getContext('2d');
    var cancelRun = null;

    switch (preset) {
      case 'splash':
        cancelRun = runSplash(canvas, ctx);
        break;
      case 'student':
        cancelRun = runStudent(canvas, ctx);
        break;
      case 'slowChaotic':
      default:
        cancelRun = runSlowChaotic(canvas, ctx);
    }

    return {
      cancel: function () {
        window.removeEventListener('resize', resizeHandler);
        if (cancelRun) cancelRun();
      }
    };
  }

  window.startParticles = startParticles;
})();

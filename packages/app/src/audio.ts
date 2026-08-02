/* ============================================================
   audio — 소리를 코드로 합성해 낸다(음원 파일 없음)
   ------------------------------------------------------------
   왜 합성인가: 음원 파일을 두는 순간 에셋 파이프라인·라이선스·로딩 실패
   처리·번들 증가가 한꺼번에 딸려 온다. 아케이드 효과음은 오실레이터 하나로
   충분하고, 이 방식은 번들을 0KB 늘린다.

   나중에 특정 소리만 파일로 바꾸고 싶으면 SOUNDS 표의 그 줄만 갈아끼우면
   된다 — 부르는 쪽은 play("click")밖에 모른다. 교체 지점이 한 곳이다.

   ⚠️ 순수 출력 레이어다. 여기서 나는 소리는 tick·시드·판정·동기화에 영향을
   주지 않는다(AGENTS.md 4-1의 「독립 시각 레이어」와 같은 취급).

   ⚠️ 자동재생 정책: AudioContext는 사용자 제스처 전에 소리를 못 낸다. 그래서
   미리 만들지 않고 **첫 재생 때** 만든다 — play()는 지금 클릭 핸들러에서만
   불리므로 생성 시점이 곧 제스처 안이다. 탭을 옮기면 다시 잠들 수 있어서
   재생마다 상태를 확인해 깨운다.

   소리가 안 나는 건 게임을 못 하게 만들 이유가 아니다. 이 파일의 모든 실패
   경로는 **조용한 무음**으로 떨어지고 절대 던지지 않는다.
   ============================================================ */

import { loadMuted, saveMuted } from "./prefs";

/** 지금 낼 수 있는 소리. 늘어나면 SOUNDS에 줄을 추가한다. */
export type SoundId = "click";

type Tone = {
  /** 파형. square는 각진 8비트 소리, triangle은 같은 음정이라도 덜 날카롭다. */
  wave: OscillatorType;
  /** Hz 목록. 둘 이상이면 step 간격으로 이어 붙어 짧은 프레이즈가 된다. */
  freq: readonly number[];
  /** 음 하나의 길이(초). */
  step: number;
  /** 이 소리의 최고 음량(0~1). 마스터 게인에 곱해진다. */
  gain: number;
};

/** 슬러그 → 소리. 부르는 쪽은 이 표의 내용을 모른다. */
const SOUNDS: Record<SoundId, Tone> = {
  // UI 클릭: 짧고 높게. 연타해도 피곤하지 않도록 square가 아니라 triangle.
  click: { wave: "triangle", freq: [880], step: 0.045, gain: 0.6 },
};

/** 마스터 음량. 합성음은 같은 수치의 음원 파일보다 크게 들려 낮게 잡았다. */
const MASTER_GAIN = 0.25;
/** 어택(초). 0에서 최대로 즉시 뛰면 파형이 끊겨 '툭' 하는 잡음이 섞인다. */
const ATTACK = 0.004;
/** 지수 램프는 0에 닿을 수 없다 — 사실상 무음인 하한을 대신 쓴다. */
const MIN_GAIN = 0.0001;
/** 동시에 울릴 수 있는 음의 수. 넘치면 새 소리를 버린다(오래된 걸 끊지 않는다
 *  — 끊긴 소리는 안 난 소리보다 더 티가 난다). */
const MAX_VOICES = 8;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = false;
let voices = 0;

/** 저장된 소리 설정을 읽어 온다. 앱 시작 때 한 번 부른다. */
export function initAudio(): void {
  muted = loadMuted();
}

/** 지금 소리가 꺼져 있는가. 토글 버튼의 표시에 쓴다. */
export function isMuted(): boolean {
  return muted;
}

/** 소리를 켜고 끈다. 다음 방문에도 유지된다.
 *  ⚠️ 여기서 확인음을 내지 않는다 — 토글도 버튼이라 main.ts의 위임 클릭음이
 *  이미 울린다(켤 때만 들리고 끌 때는 안 들린다 = 정확히 맞는 동작). */
export function setMuted(next: boolean): void {
  muted = next;
  saveMuted(next);
}

/** 소리 하나를 낸다. 꺼져 있거나 오디오를 못 쓰면 조용히 아무것도 안 한다. */
export function play(id: SoundId): void {
  if (muted) return;
  const audio = ensureContext();
  if (!audio || !master) return;
  const tone = SOUNDS[id];
  if (voices + tone.freq.length > MAX_VOICES) return;
  try {
    schedule(audio, master, tone);
  } catch {
    /* 노드 생성/스케줄 실패는 무음으로 넘긴다. */
  }
}

/** 테스트 전용 — 모듈 전역(컨텍스트·목소리 수)을 초기 상태로 되돌린다. */
export function resetAudioForTest(): void {
  ctx = null;
  master = null;
  muted = false;
  voices = 0;
}

function ensureContext(): AudioContext | null {
  if (ctx) {
    // 탭을 옮기거나 정책이 걸리면 다시 잠든다 — 재생마다 확인해 깨운다.
    if (ctx.state === "suspended") wake(ctx);
    return ctx;
  }
  if (typeof AudioContext === "undefined") return null; // 오디오 없는 환경(SSR·구형)
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = MASTER_GAIN;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
    master = null;
  }
  return ctx;
}

/** resume은 Promise를 준다 — 거절돼도 조용히 넘긴다(소리만 안 날 뿐이다). */
function wake(audio: AudioContext): void {
  try {
    Promise.resolve(audio.resume()).catch(() => {});
  } catch {
    /* 무시 */
  }
}

function schedule(audio: AudioContext, out: GainNode, tone: Tone): void {
  const start = audio.currentTime;
  tone.freq.forEach((hz, index) => {
    const at = start + index * tone.step;
    const osc = audio.createOscillator();
    const env = audio.createGain();
    osc.type = tone.wave;
    osc.frequency.setValueAtTime(hz, at);
    // 어택-디케이 봉투. 소리를 켜고 끄는 순간을 뭉개야 잡음이 안 섞인다.
    env.gain.setValueAtTime(MIN_GAIN, at);
    env.gain.linearRampToValueAtTime(tone.gain, at + ATTACK);
    env.gain.exponentialRampToValueAtTime(MIN_GAIN, at + tone.step);
    osc.connect(env);
    env.connect(out);
    voices += 1;
    // 오실레이터는 일회용이다. 끝나면 그래프에서 떼어내야 노드가 쌓이지 않는다.
    osc.onended = () => {
      voices -= 1;
      try {
        osc.disconnect();
        env.disconnect();
      } catch {
        /* 이미 끊긴 노드 */
      }
    };
    osc.start(at);
    osc.stop(at + tone.step);
  });
}

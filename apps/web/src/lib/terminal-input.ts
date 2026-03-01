const ESC = "\u001b";
const CSI_MOUSE_PREFIX = `${ESC}[<`;
const X10_MOUSE_PREFIX = `${ESC}[M`;
const URXVT_MOUSE_PREFIX = `${ESC}[`;
const INTEGER_RE = /^\d+$/;
const MOUSE_MOTION_BIT_DIVISOR = 32;
const MOUSE_WHEEL_BIT_DIVISOR = 64;
const MOUSE_PROTOCOL_PART_COUNT = 3;
const X10_EVENT_OFFSET = 32;
const X10_PAYLOAD_LENGTH = 3;
const CSI_TERMINATOR_PRESS = "M";
const CSI_TERMINATOR_RELEASE = "m";

const isIntegerString = (value: string): boolean => INTEGER_RE.test(value);

const isMouseMovementCode = (code: number): boolean => {
  if (!Number.isFinite(code) || code < 0) {
    return false;
  }

  const hasMotionBit = Math.floor(code / MOUSE_MOTION_BIT_DIVISOR) % 2 === 1;
  const hasWheelBit = Math.floor(code / MOUSE_WHEEL_BIT_DIVISOR) % 2 === 1;
  return hasMotionBit && !hasWheelBit;
};

const parseCsiMouseCode = (
  value: string,
  start: number
): { code: number; nextIndex: number } | null => {
  const terminator = value.indexOf(CSI_TERMINATOR_PRESS, start);
  const releaseTerminator = value.indexOf(CSI_TERMINATOR_RELEASE, start);

  let end = -1;
  if (terminator === -1) {
    end = releaseTerminator;
  } else if (releaseTerminator === -1) {
    end = terminator;
  } else {
    end = Math.min(terminator, releaseTerminator);
  }

  if (end === -1) {
    return null;
  }

  const body = value.slice(start + CSI_MOUSE_PREFIX.length, end);
  const parts = body.split(";");
  if (
    parts.length !== MOUSE_PROTOCOL_PART_COUNT ||
    !parts.every((part) => part.length > 0 && isIntegerString(part))
  ) {
    return null;
  }

  const codeText = parts[0];
  if (!codeText) {
    return null;
  }

  return {
    code: Number.parseInt(codeText, 10),
    nextIndex: end + 1,
  };
};

const parseX10MouseCode = (
  value: string,
  start: number
): { code: number; nextIndex: number } | null => {
  const eventCodeIndex = start + X10_MOUSE_PREFIX.length;
  const lastPayloadByteIndex = eventCodeIndex + X10_PAYLOAD_LENGTH - 1;
  if (lastPayloadByteIndex >= value.length) {
    return null;
  }

  return {
    code: value.charCodeAt(eventCodeIndex) - X10_EVENT_OFFSET,
    nextIndex: eventCodeIndex + X10_PAYLOAD_LENGTH,
  };
};

const parseUrxvtMouseCode = (
  value: string,
  start: number
): { code: number; nextIndex: number } | null => {
  const end = value.indexOf(
    CSI_TERMINATOR_PRESS,
    start + URXVT_MOUSE_PREFIX.length
  );
  if (end === -1) {
    return null;
  }

  const body = value.slice(start + URXVT_MOUSE_PREFIX.length, end);
  const parts = body.split(";");
  if (
    parts.length !== MOUSE_PROTOCOL_PART_COUNT ||
    !parts.every((part) => part.length > 0 && isIntegerString(part))
  ) {
    return null;
  }

  const codeText = parts[0];
  if (!codeText) {
    return null;
  }

  return {
    code: Number.parseInt(codeText, 10),
    nextIndex: end + 1,
  };
};

export const isMouseMovementInputChunk = (value: string): boolean => {
  if (value.length === 0) {
    return false;
  }

  let index = 0;
  while (index < value.length) {
    let parsed: { code: number; nextIndex: number } | null = null;
    if (value.startsWith(CSI_MOUSE_PREFIX, index)) {
      parsed = parseCsiMouseCode(value, index);
    } else if (value.startsWith(X10_MOUSE_PREFIX, index)) {
      parsed = parseX10MouseCode(value, index);
    } else if (value.startsWith(URXVT_MOUSE_PREFIX, index)) {
      parsed = parseUrxvtMouseCode(value, index);
    } else {
      return false;
    }

    if (!(parsed && isMouseMovementCode(parsed.code))) {
      return false;
    }

    index = parsed.nextIndex;
  }

  return true;
};

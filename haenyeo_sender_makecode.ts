// ==============================================
// 해녀용 마이크로비트 (송신기) - MakeCode JavaScript
// makecode.microbit.org → 새 프로젝트 → 위쪽 "JavaScript" 탭에 통째로 붙여넣기
// ==============================================
// 해녀마다 번호를 다르게 바꿔서 다운로드하세요 (1~99)
const DIVER_ID = 1
// 수신용 마이크로비트와 같은 그룹 번호여야 합니다
const RADIO_GROUP = 77
// 맥박 센서(아날로그, 예: Pulse Sensor)를 P0에 연결했다면 true
const PULSE_SENSOR = false
// 맥박 센서 박동 판단 기준값 (센서마다 다르므로 시리얼로 값을 보고 조정)
const PULSE_THRESHOLD = 550

radio.setGroup(RADIO_GROUP)
radio.setTransmitPower(7)

let sos = 0          // 1이면 해녀가 직접 SOS 요청
let fall = 0         // 1이면 자유낙하 또는 강한 충격 감지
let lastMove = input.runningTime()
let bpm = -1         // 맥박 센서가 없으면 -1
let lastBeat = 0
let beatHigh = false

// 쓰러짐 후보: 자유낙하, 6g 이상 충격
input.onGesture(Gesture.FreeFall, function () {
    fall = 1
})
input.onGesture(Gesture.SixG, function () {
    fall = 1
})

// A+B 동시에 누르기 = SOS
input.onButtonPressed(Button.AB, function () {
    sos = 1
    basic.showIcon(IconNames.No)
})
// A 버튼 = "괜찮아요" (SOS·쓰러짐 해제)
input.onButtonPressed(Button.A, function () {
    sos = 0
    fall = 0
    basic.showIcon(IconNames.Yes)
    basic.pause(500)
    basic.clearScreen()
})

// 움직임 감지 (0.1초마다)
control.inBackground(function () {
    while (true) {
        const s = input.acceleration(Dimension.Strength)
        // 가만히 있으면 약 1024(중력). 그보다 크게 벗어나면 움직인 것
        if (Math.abs(s - 1024) > 150) {
            lastMove = input.runningTime()
        }
        basic.pause(100)
    }
})

// 맥박 측정 (0.02초마다)
if (PULSE_SENSOR) {
    control.inBackground(function () {
        while (true) {
            const v = pins.analogReadPin(AnalogPin.P0)
            const now = input.runningTime()
            if (v > PULSE_THRESHOLD && !beatHigh) {
                beatHigh = true
                const gap = now - lastBeat
                lastBeat = now
                if (gap > 300 && gap < 2000) {
                    const b = Math.round(60000 / gap)
                    bpm = bpm < 0 ? b : Math.round(bpm * 0.7 + b * 0.3)
                }
            } else if (v < PULSE_THRESHOLD - 50) {
                beatHigh = false
            }
            // 4초 넘게 박동이 안 잡히면 측정 불가로 표시
            if (now - lastBeat > 4000) {
                bpm = 0
            }
            basic.pause(20)
        }
    })
}

// 1초마다 전송. 라디오 문자열은 최대 19글자라서 짧게 보냅니다.
// 형식: 번호,온도,맥박,쓰러짐,무움직임초,SOS   예) 1,18,72,0,3,0
basic.forever(function () {
    let still = Math.idiv(input.runningTime() - lastMove, 1000)
    if (still > 999) still = 999
    const msg = DIVER_ID + "," + input.temperature() + "," + bpm + "," + fall + "," + still + "," + sos
    radio.sendString(msg)
    if (sos == 0 && fall == 0) {
        led.toggle(2, 2)   // 가운데 불빛이 깜빡이면 정상 전송 중
    }
    basic.pause(1000)
})

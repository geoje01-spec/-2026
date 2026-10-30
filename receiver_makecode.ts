// ==============================================
// 수신용 마이크로비트 (배·해안 PC에 USB로 연결) - MakeCode JavaScript
// 해녀 → PC: 측정값과 버튼 응답을 PC 웹앱으로 전달
// PC → 해녀: 웹앱(AI 에이전트)의 확인 신호(Q), 휴식 신호(R), 도움 신호(H)를 해녀 마이크로비트로 전달
// ==============================================
const RADIO_GROUP = 77   // 해녀용과 같은 번호

radio.setGroup(RADIO_GROUP)
radio.setTransmitPower(7)
serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)
basic.showIcon(IconNames.Diamond)

// 해녀 → PC
//  측정값: D,번호,온도,맥박,쓰러짐,무움직임초,SOS,신호세기
//  버튼 응답: A,번호
radio.onReceivedString(function (s) {
    if (s.charAt(0) == "A") {
        serial.writeLine(s)
        basic.showIcon(IconNames.Yes)
        return
    }
    const rssi = radio.receivedPacket(RadioPacketProperty.SignalStrength)
    serial.writeLine("D," + s + "," + rssi)
    led.toggle(2, 2)
})

// PC → 해녀: Q,번호 / R,번호 / H,번호 를 받으면 라디오로 3번 보냄 (놓치지 않게)
serial.onDataReceived(serial.delimiters(Delimiters.NewLine), function () {
    const line = serial.readUntil(serial.delimiters(Delimiters.NewLine)).trim()
    if (line.indexOf("Q,") == 0 || line.indexOf("R,") == 0 || line.indexOf("H,") == 0) {
        for (let i = 0; i < 3; i++) {
            radio.sendString(line)
            basic.pause(100)
        }
        if (line.charAt(0) == "Q") basic.showIcon(IconNames.Surprised)
        else if (line.charAt(0) == "H") basic.showIcon(IconNames.Skull)
        else basic.showArrow(ArrowNames.North)
    }
})

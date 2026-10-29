// ==============================================
// 수신용 마이크로비트 (배·해안 PC에 USB로 연결) - MakeCode JavaScript
// 해녀용 마이크로비트의 라디오 신호를 받아 PC 웹앱으로 그대로 전달합니다.
// ==============================================
const RADIO_GROUP = 77   // 해녀용과 같은 번호

radio.setGroup(RADIO_GROUP)
serial.redirectToUSB()
serial.setBaudRate(BaudRate.BaudRate115200)
basic.showIcon(IconNames.Diamond)

// 받은 내용 + 신호 세기를 한 줄로 PC에 보냄
// 형식: D,번호,온도,맥박,쓰러짐,무움직임초,SOS,신호세기
radio.onReceivedString(function (s) {
    const rssi = radio.receivedPacket(RadioPacketProperty.SignalStrength)
    serial.writeLine("D," + s + "," + rssi)
    led.toggle(2, 2)
})

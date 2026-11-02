# [기본 방식 - 수신용 마이크로비트 (받는 쪽), Python 전용]
# makecode.microbit.org → 새 프로젝트 → 위쪽 "Python" 탭에 통째로 붙여넣기 → 수신용 마이크로비트에 다운로드
# 배·해안 PC에 USB로 연결. 해녀용(haenyeo_sender_python.py)과 짝. 라디오 그룹 77
#
# 해녀 → PC (USB로 웹앱에 한 줄씩)
#   측정값:    D,번호,온도,맥박,쓰러짐,무움직임초,SOS,신호세기
#   버튼 응답: A,번호
# PC → 해녀
#   웹앱(AI 에이전트)의 Q,번호(괜찮으세요?) / R,번호(쉬러 나오세요) / H,번호(도움 신호)를
#   라디오로 3번 보냄 (놓치지 않게)
# 신호 받는 곳에서는 그림을 보여 주지 않음 (그림 보여 주는 동안 다음 신호를 놓치므로). 그림은 아래 반복에서

RADIO_GROUP = 77   # 해녀용과 같은 번호

radio.set_group(RADIO_GROUP)
radio.set_transmit_power(7)
serial.redirect_to_usb()
serial.set_baud_rate(BaudRate.BAUD_RATE115200)
basic.show_icon(IconNames.DIAMOND)

show = 0   # 보여 줄 그림: 0 없음, 1 괜찮아요(체크), 2 확인 신호(놀란 얼굴), 3 도움 신호(해골), 4 휴식 신호(화살표)
got = 0    # 지금까지 받은 해녀 신호 수

# 해녀 → PC
def on_received_string(s):
    global show, got
    got += 1
    if s[0:1] == "A":
        serial.write_line(s)
        show = 1
        return
    rssi = radio.received_packet(RadioPacketProperty.SIGNAL_STRENGTH)
    serial.write_line("D," + s + "," + str(rssi))
    led.toggle(2, 2)   # 가운데 불빛이 깜빡이면 해녀 신호를 받는 중
radio.on_received_string(on_received_string)

# PC → 해녀
def on_data_received():
    global show
    line = serial.read_until(serial.delimiters(Delimiters.NEW_LINE)).strip()
    head = line[0:2]
    if head == "Q," or head == "R," or head == "H,":
        for i in range(3):
            radio.send_string(line)
            basic.pause(100)
        if head == "Q,":
            show = 2
        elif head == "H,":
            show = 3
        else:
            show = 4
serial.on_data_received(serial.delimiters(Delimiters.NEW_LINE), on_data_received)

# 3초마다 "HB,받은수"를 PC로 보냄 → 웹앱이 수신기는 잘 연결됐는지, 해녀 신호가 안 오는 건지 구별
def heartbeat_loop():
    while True:
        serial.write_line("HB," + str(got))
        basic.pause(3000)
control.in_background(heartbeat_loop)

# 그림은 여기서만 보여 줌
def on_forever_screen():
    global show
    if show == 1:
        show = 0
        basic.show_icon(IconNames.YES)
        basic.pause(500)
        basic.clear_screen()
    elif show == 2:
        show = 0
        basic.show_icon(IconNames.SURPRISED)
        basic.pause(500)
        basic.clear_screen()
    elif show == 3:
        show = 0
        basic.show_icon(IconNames.SKULL)
        basic.pause(500)
        basic.clear_screen()
    elif show == 4:
        show = 0
        basic.show_arrow(ArrowNames.NORTH)
        basic.pause(500)
        basic.clear_screen()
    else:
        basic.pause(50)
basic.forever(on_forever_screen)

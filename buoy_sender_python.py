# [2. 해녀용 마이크로비트 - 부표 방식, Python 전용]
# makecode.microbit.org → 새 프로젝트 → 위쪽 "Python" 탭에 통째로 붙여넣기 → 해녀용 마이크로비트에 다운로드
# 부표(buoy_receiver_python.py)와 짝. 라디오 그룹 1에서 숫자를 계속 보냄:
#   1  = 물 위에 있음 (0.3초마다)
#   99 = SOS (A+B 동시에 누르면 5초 동안 보냄)
# 물에 들어가면 전파가 끊기고, 부표는 3초 끊기면 "입수"로 알림.
# 0.3초마다 보내므로 전파를 몇 번 놓쳐도 3초까지 가지 않음 → 물 밖에서 잘못 "입수"가 되는 일이 줄어듦

SEND_MS = 300    # 보내는 간격 (부표 입수 기준 3초보다 훨씬 짧게)
SOS_MS = 5000    # SOS를 보내는 시간

sos_until = 0

radio.set_group(1)
radio.set_transmit_power(7)

# A+B 동시에 누르기 = SOS
def on_button_pressed_ab():
    global sos_until
    sos_until = input.running_time() + SOS_MS
    basic.show_icon(IconNames.NO)
input.on_button_pressed(Button.AB, on_button_pressed_ab)

# A나 B 하나만 누르면 SOS 취소
def on_button_pressed_a():
    global sos_until
    if sos_until > 0:
        sos_until = 0
        basic.show_icon(IconNames.YES)
        basic.pause(300)
        basic.clear_screen()
input.on_button_pressed(Button.A, on_button_pressed_a)
input.on_button_pressed(Button.B, on_button_pressed_a)

def on_forever():
    global sos_until
    if input.running_time() < sos_until:
        radio.send_number(99)
    else:
        if sos_until > 0:
            sos_until = 0
            basic.clear_screen()
        radio.send_number(1)
        led.toggle(2, 2)   # 가운데 불빛이 깜빡이면 정상 전송 중
    basic.pause(SEND_MS)
basic.forever(on_forever)

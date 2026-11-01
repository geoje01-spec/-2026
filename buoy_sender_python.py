# [2. 해녀용 마이크로비트 - 부표 방식, Python 전용]
# makecode.microbit.org → 새 프로젝트 → 위쪽 "Python" 탭에 통째로 붙여넣기 → 해녀용 마이크로비트에 다운로드
# 부표(buoy_receiver_python.py)와 짝. 라디오 그룹 1에서 숫자를 보냄:
#   1  = 물 위에 있음 (물 위 상태인 동안 0.3초마다 계속)
#   99 = SOS (5초 동안)
# 부표는 신호가 3초 끊기면 "입수", 다시 잡히면 "복귀"로 알림.
#
# 버튼 (물에 넣지 않고 시연할 때)
#   A     = 물 위 → 신호를 계속 보냄 (가운데 불빛 깜빡임)
#   B     = 물속 → 신호를 멈춤 (아래 화살표가 켜져 있음)
#   A+B   = SOS → 99를 5초 보내고 물 위 상태로 돌아감
# 버튼을 한 번 누를 때만 신호를 보내면 3초 뒤 부표가 "입수"로 봄 → 그래서 물 위 상태 동안은 계속 보냄
# 켜면 물 위 상태로 시작 (실제로 물에 들어가면 전파가 끊겨 버튼 없이도 입수가 잡힘)

SEND_MS = 300    # 보내는 간격 (부표 입수 기준 3초보다 훨씬 짧게)
SOS_MS = 5000    # SOS를 보내는 시간

surface = True   # True 물 위(신호 보냄), False 물속(신호 멈춤)
sos_until = 0

radio.set_group(1)
radio.set_transmit_power(7)

# A = 물 위
def on_button_pressed_a():
    global surface, sos_until
    surface = True
    sos_until = 0
    basic.show_arrow(ArrowNames.NORTH)
    basic.clear_screen()
input.on_button_pressed(Button.A, on_button_pressed_a)

# B = 물속 (신호 멈춤)
def on_button_pressed_b():
    global surface, sos_until
    surface = False
    sos_until = 0
    basic.show_arrow(ArrowNames.SOUTH)   # 물속인 동안 아래 화살표를 켜 둠
input.on_button_pressed(Button.B, on_button_pressed_b)

# A+B 동시에 누르기 = SOS
def on_button_pressed_ab():
    global surface, sos_until
    surface = True
    sos_until = input.running_time() + SOS_MS
    basic.show_icon(IconNames.NO)
input.on_button_pressed(Button.AB, on_button_pressed_ab)

def on_forever():
    global sos_until
    if sos_until > 0 and input.running_time() < sos_until:
        radio.send_number(99)
    elif surface:
        if sos_until > 0:
            sos_until = 0
            basic.clear_screen()
        radio.send_number(1)
        led.toggle(2, 2)   # 가운데 불빛이 깜빡이면 물 위 신호를 보내는 중
    basic.pause(SEND_MS)
basic.forever(on_forever)

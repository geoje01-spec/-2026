# [기본 방식 - 해녀용 마이크로비트 (보내는 쪽), Python 전용]
# makecode.microbit.org → 새 프로젝트 → 위쪽 "Python" 탭에 통째로 붙여넣기 → 해녀용 마이크로비트에 다운로드
# 수신용(receiver_python.py)과 짝. 라디오 그룹 77
#
# 1초마다 보내는 것 (라디오 문자열은 최대 19글자라 짧게)
#   번호,온도,맥박,쓰러짐,무움직임초,SOS   예) 1,18,72,0,3,0
#   꼭 1초 간격 유지: 관제는 4초 넘게 안 오면 물속으로 판단
#   물에 들어가면 라디오가 끊기고, 올라오면 다시 잡힘. 그 끊긴 시간이 잠수 시간
#
# 관제(웹앱 AI 에이전트)에서 오는 신호
#   Q,번호        괜찮으세요? → 놀란 얼굴·소리, A나 B 버튼으로 "괜찮아요"
#   R,번호 / R,0  쉬러 나오세요 → 위쪽 화살표와 낮은 소리 10초
#   H,번호        다른 해녀가 물속에서 안 올라옴 → 내가 그 해녀가 아니면 경고 표시와 높은 소리 15초
#
# 버튼
#   A 또는 B  = 괜찮아요 (장갑 낀 손으로 아무거나)
#   A+B       = SOS (확인 없이 바로 신고)

DIVER_ID = 1          # 해녀마다 번호를 다르게 바꿔서 다운로드 (1~99)
RADIO_GROUP = 77      # 수신용 마이크로비트와 같은 번호
PULSE_SENSOR = False  # 맥박 센서(아날로그, 예: Pulse Sensor)를 P0에 연결했다면 True
PULSE_THRESHOLD = 550 # 맥박 센서 박동 판단 기준값 (센서마다 다르므로 시리얼로 값을 보고 조정)

radio.set_group(RADIO_GROUP)
radio.set_transmit_power(7)

sos = 0            # 1이면 해녀가 직접 SOS 요청
fall = 0           # 1이면 자유낙하 또는 강한 충격 감지
asking = False     # True면 관제가 "괜찮으세요?" 확인 중
recall_until = 0   # 이 시각까지 "쉬러 나오세요" 알림
help_until = 0     # 이 시각까지 "동료가 위험해요" 알림
last_move = input.running_time()
bpm = -1           # 맥박 센서가 없으면 -1
last_beat = 0
beat_high = False

# 쓰러짐 후보: 자유낙하, 6g 이상 충격
def on_gesture_free_fall():
    global fall
    fall = 1
input.on_gesture(Gesture.FREE_FALL, on_gesture_free_fall)

def on_gesture_six_g():
    global fall
    fall = 1
input.on_gesture(Gesture.SIX_G, on_gesture_six_g)

# 관제에서 오는 신호 (여기서는 기록만 하고 바로 끝냄. 그림·소리는 아래 반복에서)
def on_received_string(s):
    global asking, recall_until, help_until
    if s == "Q," + str(DIVER_ID):
        asking = True
    elif s == "R," + str(DIVER_ID) or s == "R,0":
        recall_until = input.running_time() + 10000
    elif s[0:2] == "H," and s != "H," + str(DIVER_ID):
        help_until = input.running_time() + 15000
radio.on_received_string(on_received_string)

# 휴식·도움 알림 그림과 소리
def alarm_loop():
    while True:
        if not asking and input.running_time() < help_until:
            basic.show_icon(IconNames.SKULL)
            music.play_tone(1047, music.beat(BeatFraction.QUARTER))   # 높은 도(C6). MakeCode 음 이름은 B5까지만 있어서 숫자로
            music.play_tone(Note.A5, music.beat(BeatFraction.QUARTER))
            basic.pause(200)
            basic.clear_screen()
            basic.pause(200)
        elif not asking and input.running_time() < recall_until:
            basic.show_arrow(ArrowNames.NORTH)
            music.play_tone(Note.G4, music.beat(BeatFraction.HALF))
            basic.pause(300)
            basic.clear_screen()
            basic.pause(300)
        else:
            basic.pause(200)
control.in_background(alarm_loop)

# "괜찮으세요?" 확인 중일 때 그림과 소리 (V2는 내장 스피커, V1은 P0 부저)
def ask_loop():
    while True:
        if asking:
            basic.show_icon(IconNames.SURPRISED)
            music.play_tone(Note.C5, music.beat(BeatFraction.QUARTER))
            basic.pause(150)
            basic.clear_screen()
            music.play_tone(Note.G5, music.beat(BeatFraction.QUARTER))
            basic.pause(150)
        else:
            basic.pause(200)
control.in_background(ask_loop)

# "괜찮아요" 응답 = A 또는 B 버튼
def answer_ok():
    global asking, sos, fall
    if asking:
        asking = False
        for i in range(3):   # 놓치지 않게 3번 보냄
            radio.send_string("A," + str(DIVER_ID))
            basic.pause(100)
    sos = 0
    fall = 0
    basic.show_icon(IconNames.YES)
    basic.pause(500)
    basic.clear_screen()

def on_button_pressed_a():
    answer_ok()
input.on_button_pressed(Button.A, on_button_pressed_a)

def on_button_pressed_b():
    answer_ok()
input.on_button_pressed(Button.B, on_button_pressed_b)

# A+B 동시에 누르기 = SOS
def on_button_pressed_ab():
    global sos, asking
    sos = 1
    asking = False
    basic.show_icon(IconNames.NO)
input.on_button_pressed(Button.AB, on_button_pressed_ab)

# 움직임 감지 (0.1초마다). 가만히 있으면 약 1024(중력), 크게 벗어나면 움직인 것
def move_loop():
    global last_move
    while True:
        if abs(input.acceleration(Dimension.STRENGTH) - 1024) > 150:
            last_move = input.running_time()
        basic.pause(100)
control.in_background(move_loop)

# 맥박 측정 (0.02초마다)
def pulse_loop():
    global beat_high, last_beat, bpm
    while True:
        v = pins.analog_read_pin(AnalogPin.P0)
        now = input.running_time()
        if v > PULSE_THRESHOLD and not beat_high:
            beat_high = True
            gap = now - last_beat
            last_beat = now
            if gap > 300 and gap < 2000:
                b = int(60000 / gap + 0.5)
                if bpm < 0:
                    bpm = b
                else:
                    bpm = int(bpm * 0.7 + b * 0.3 + 0.5)
        elif v < PULSE_THRESHOLD - 50:
            beat_high = False
        # 4초 넘게 박동이 안 잡히면 측정 불가로 표시
        if now - last_beat > 4000:
            bpm = 0
        basic.pause(20)
if PULSE_SENSOR:
    control.in_background(pulse_loop)

# 1초마다 전송
def on_forever():
    still = (input.running_time() - last_move) // 1000
    if still > 999:
        still = 999
    msg = str(DIVER_ID) + "," + str(input.temperature()) + "," + str(bpm) + "," + str(fall) + "," + str(still) + "," + str(sos)
    radio.send_string(msg)
    t = input.running_time()
    if sos == 0 and fall == 0 and not asking and t >= recall_until and t >= help_until:
        led.toggle(2, 2)   # 가운데 불빛이 깜빡이면 정상 전송 중
    basic.pause(1000)
basic.forever(on_forever)

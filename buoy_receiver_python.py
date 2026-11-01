# [1. 부표 마이크로비트 - Python 전용]
# 태왁(부표)에 다는 마이크로비트. 해녀 마이크로비트가 보내는 숫자 신호를 받아
# 신호가 3초 끊기면 "입수", 다시 잡히면 "복귀"로 보고 USB로 숨비 지킴이 웹앱에 알려 줌.
# 웹앱(index.html)이 읽는 줄:
#   EVENT: DIVER SUBMERGED              → 물질 중(물속)으로 바뀜
#   EVENT: DIVER RETURNED TO SURFACE    → 휴식 중(물 위), 잠수 시간 기록
#   ALERT: EMERGENCY SOS BUTTON ...     → SOS, 확인 없이 바로 모의 신고
#   ALERT: EMERGENCY DIVER TIME EXCEEDED → 부표 경보로 기록·알림 (단계 판단은 웹앱 설정 기준)
#   INFO: RX 5 RSSI -55 GAP 1000        → 진단: 5초 동안 받은 신호 수, 신호 세기, 가장 길게 끊긴 시간(ms)
# 해녀 마이크로비트: 라디오 그룹 1, 물 위에서 숫자를 계속 보내고(1초에 1번 이상), SOS는 99
# (2026-11-01) SOS를 받으면 복귀 처리 없이 끝나서 부표가 계속 "물속"으로 알던 문제를 고침: 복귀 처리를 먼저 함
# (2026-11-01) 신호가 중간에 끊기던 문제를 고침
#   1) 신호를 받는 곳에서 그림·글자(SOS 글자는 약 3초)를 보여 주는 동안 다음 신호를 못 받아 "입수"로 잘못 알림
#      → 그림은 따로 도는 반복에서 보여 줌. 신호 받는 곳은 기록만 하고 바로 끝냄
#   2) 2초 기준은 해녀용이 1초마다 보낼 때 한 번만 놓쳐도 "입수"가 됨 → 3초로 늘림

GAP_MS = 3000   # 신호가 이만큼 끊기면 입수로 봄

is_diver_submerged = False
dive_start_time = 0
last_diver_signal_time = 0
last_alert_time = 0
show = 0        # 보여 줄 그림: 0 없음, 1 복귀(웃는 얼굴), 2 SOS, 3 시간 초과
packets = 0     # 진단용: 최근 5초 동안 받은 신호 수
last_rssi = 0
max_gap = 0
last_info_time = 0

radio.set_group(1)

def on_forever():
    global is_diver_submerged, dive_start_time, last_alert_time, show
    global packets, max_gap, last_info_time
    current_time = input.running_time()

    # 3초간 신호 차단 시 입수 간주
    if last_diver_signal_time > 0:
        if (current_time - last_diver_signal_time) > GAP_MS:
            if is_diver_submerged == False:
                is_diver_submerged = True
                dive_start_time = current_time
                serial.write_line("EVENT: DIVER SUBMERGED")

    # 10초 잠수 제한시간 초과 시 부표에서 알림 출력 (시연용 10초. 웹앱의 단계 기준은 설정에서 따로 정함)
    if is_diver_submerged == True:
        if (current_time - dive_start_time) > 10000:
            if (current_time - last_alert_time) > 3000:
                last_alert_time = current_time
                serial.write_line("ALERT: EMERGENCY DIVER TIME EXCEEDED")
                show = 3

    # 5초마다 진단 줄: 받은 신호 수·세기·가장 길게 끊긴 시간
    if (current_time - last_info_time) >= 5000:
        last_info_time = current_time
        serial.write_line("INFO: RX " + str(packets) + " RSSI " + str(last_rssi) + " GAP " + str(max_gap))
        packets = 0
        max_gap = 0

    basic.pause(100)

basic.forever(on_forever)

# 그림은 여기서만 보여 줌 (신호 받는 곳을 막지 않게)
def on_forever_screen():
    global show
    if show == 2:
        show = 0
        basic.show_string("SOS")
        basic.clear_screen()
    elif show == 1:
        show = 0
        basic.show_icon(IconNames.HAPPY)
        basic.clear_screen()
    elif show == 3:
        show = 0
        basic.show_icon(IconNames.NO)
        basic.clear_screen()
    else:
        basic.pause(50)

basic.forever(on_forever_screen)

def on_received_number(receivedNumber):
    global is_diver_submerged, last_diver_signal_time, show, packets, last_rssi, max_gap
    current_time = input.running_time()
    if last_diver_signal_time > 0:
        max_gap = max(max_gap, current_time - last_diver_signal_time)
    last_diver_signal_time = current_time
    packets += 1
    last_rssi = radio.received_packet(RadioPacketProperty.SIGNAL_STRENGTH)
    led.toggle(4, 4)   # 오른쪽 아래 불빛이 깜빡이면 신호를 받는 중

    # 수면 복귀 처리 (신호가 닿았다 = 물 위). SOS보다 먼저 해야 부표가 계속 물속으로 알지 않음
    if is_diver_submerged == True:
        is_diver_submerged = False
        serial.write_line("EVENT: DIVER RETURNED TO SURFACE")
        show = 1

    # 수면 SOS 수신 (99번 신호)
    if receivedNumber == 99:
        serial.write_line("ALERT: EMERGENCY SOS BUTTON PRESSED BY DIVER!")
        show = 2

radio.on_received_number(on_received_number)

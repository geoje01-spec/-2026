# [1. 부표 마이크로비트 - Python 전용]
# 태왁(부표)에 다는 마이크로비트. 해녀 마이크로비트가 보내는 숫자 신호를 받아
# 신호가 2초 끊기면 "입수", 다시 잡히면 "복귀"로 보고 USB로 숨비 지킴이 웹앱에 알려 줌.
# 웹앱(index.html)이 읽는 줄:
#   EVENT: DIVER SUBMERGED              → 물질 중(물속)으로 바뀜
#   EVENT: DIVER RETURNED TO SURFACE    → 휴식 중(물 위), 잠수 시간 기록
#   ALERT: EMERGENCY SOS BUTTON ...     → SOS, 확인 없이 바로 모의 신고
#   ALERT: EMERGENCY DIVER TIME EXCEEDED → 부표 경보로 기록·알림 (단계 판단은 웹앱 설정 기준)
# 해녀 마이크로비트: 라디오 그룹 1, 물 위에서 숫자를 계속 보내고, SOS는 99
# (2026-11-01) SOS를 받으면 복귀 처리 없이 끝나서 부표가 계속 "물속"으로 알던 문제를 고침: 복귀 처리를 먼저 함

is_diver_submerged = False
dive_start_time = 0
last_diver_signal_time = 0
last_alert_time = 0

radio.set_group(1)

def on_forever():
    global is_diver_submerged, dive_start_time, last_diver_signal_time, last_alert_time
    current_time = input.running_time()

    # 2초간 신호 차단 시 입수 간주
    if last_diver_signal_time > 0:
        if (current_time - last_diver_signal_time) > 2000:
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
                basic.show_icon(IconNames.NO)
                basic.pause(100)
                basic.clear_screen()

    basic.pause(200)

basic.forever(on_forever)

def on_received_number(receivedNumber):
    global is_diver_submerged, last_diver_signal_time
    current_time = input.running_time()
    last_diver_signal_time = current_time

    # 수면 복귀 처리 (신호가 닿았다 = 물 위). SOS보다 먼저 해야 부표가 계속 물속으로 알지 않음
    if is_diver_submerged == True:
        is_diver_submerged = False
        serial.write_line("EVENT: DIVER RETURNED TO SURFACE")
        basic.show_icon(IconNames.HAPPY)
        basic.pause(100)
        basic.clear_screen()

    # 수면 SOS 수신 (99번 신호)
    if receivedNumber == 99:
        serial.write_line("ALERT: EMERGENCY SOS BUTTON PRESSED BY DIVER!")
        basic.show_string("SOS")
        basic.clear_screen()

radio.on_received_number(on_received_number)

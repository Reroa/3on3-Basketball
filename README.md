# Street 3on3 v0.1

실제 업로드된 에셋을 포함한 첫 통합 프로토타입입니다.

## 포함 에셋
- `public/assets/court.glb` : 사용자가 올린 농구 코트
- `public/assets/ball.glb` : 사용자가 올린 농구공
- `public/assets/player.glb` : 생성한 애니메이션 캐릭터

코트 GLB 내부에 텍스처가 포함되어 있는 것을 확인했으므로, 원본 ZIP의 textures 폴더 없이도 이 프로젝트에서 로딩됩니다.

## 구현
- 실제 코트 모델/텍스처 로딩
- 코트 링 높이를 3.05m 기준으로 자동 스케일
- 실제 링 위치에 슛 목표 좌표 설정
- 캐릭터 Idle / Run / Jump / Shot
- 농구공 모델 적용
- 자동 드리블 연출
- 2점/3점 판정
- 3인칭 추적 카메라
- 반코트 이동 범위

## 조작
- WASD: 이동
- Shift: 달리기
- Space: 점프
- F: 슛

## Colab
Google Drive의 `BBL/street_3on3_v01.zip`에 이 ZIP을 저장한 뒤
`COLAB_SINGLE_CELL.py` 내용을 Colab 셀 하나에 붙여넣으면 됩니다.

# Colab 단일 셀 실행용
from google.colab import drive, output
drive.mount('/content/drive')

import os, shutil, subprocess, time
ZIP='/content/drive/MyDrive/BBL/street_3on3_v01.zip'
ROOT='/content/street_3on3'

shutil.rmtree(ROOT, ignore_errors=True)
os.makedirs(ROOT, exist_ok=True)

subprocess.run(['unzip','-q',ZIP,'-d',ROOT], check=True)
os.chdir(ROOT)

subprocess.run(['npm','install','--silent'], check=True)
proc = subprocess.Popen(
    ['npm','run','dev'],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL
)
time.sleep(3)

output.serve_kernel_port_as_iframe(5173, height=760)

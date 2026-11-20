"""Write two short, speech-friendly cue sounds into the Remotion public folder."""
import argparse
import array
import math
from pathlib import Path
import wave
import sys

RATE = 48000


def cue(t, large):
    attack = min(1, t / .003)
    thump = math.sin(math.tau * (440*t + 430*.019*(1-math.exp(-t/.019))))
    clack = math.sin(math.tau * (1660 if large else 2070)*t)
    edge = math.sin(math.tau * 2860*t)
    if large:
        return attack * (.74*thump*math.exp(-t/.06) +
                         .36*clack*math.exp(-t/.027) + .13*edge*math.exp(-t/.012))
    return attack * (.45*thump*math.exp(-t/.032) +
                     .6*clack*math.exp(-t/.039) + .18*edge*math.exp(-t/.014))


def write(path, large):
    duration = .22 if large else .14
    data = [cue(n/RATE,large)*min(1,(duration-n/RATE)/.02) for n in range(round(duration*RATE))]
    gain = .87/max(map(abs,data))
    pcm = array.array("h",(round(v*gain*32767) for v in data))
    if sys.byteorder=="big":
        pcm.byteswap()
    with wave.open(str(path),"wb") as output:
        output.setparams((1,2,RATE,0,"NONE","not compressed"))
        output.writeframes(pcm.tobytes())


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("public",type=Path)
    directory=parser.parse_args().public
    directory.mkdir(parents=True,exist_ok=True)
    write(directory/"keyword-pop.wav",True)
    write(directory/"keyword-tick.wav",False)

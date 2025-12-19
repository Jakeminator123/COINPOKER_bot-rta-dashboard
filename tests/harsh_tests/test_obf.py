# obf_minimal.py
# Benign lab-demo: kontinuerligt, obfuskerat beteende för att ge din detektor en sportslig chans.
# - Dynamic import + exec
# - Nästan konstant period (1.200 s)
# - Ingen tråd/GUI: bara konsol, funkar fint vid dubbelklick

import time as __t
__b = __import__('builtins')
__i = __b.__dict__['__import__']

# Dynamiska modulnamn via "os", "platform", "hashlib", "time" (kovert men enkelt)
_o = ''.join([chr(c) for c in [111,115]])                       # "os"
_p = ''.join([chr(c) for c in [112,108,97,116,102,111,114,109]])# "platform"
_h = ''.join([chr(c) for c in [104,97,115,104,108,105,98]])     # "hashlib"
_t = ''.join([chr(c) for c in [116,105,109,101]])               # "time"

globals()[_o] = __i(_o)
globals()[_p] = __i(_p)
globals()[_h] = __i(_h)
globals()[_t] = __i(_t)

# Bygg "stage-2" kodsträng i bitar för att undvika ren, läsbar källa
_parts = [
    'de','f ','m():\n',
    '    ','im','port ','os,platform,hashlib,time','\n',
    '    ',"s","=","'OK'","\n",
    '    ',"p","r","i","n","t","(",
    "'",'BEACON',"'",", ","platform.system()",", ","os.getpid()",", ",
    "hashlib.sha256(s.encode()).hexdigest()[:8])","\n"
]

_SRC = ''.join(_parts)

# Kör tills Ctrl+C. Varje varv: exec (obfuskerat) + konstant delay.
if __name__ == '__main__':
    # liten header så du ser att den startat vid dubbelklick
    print("obf_minimal: running (Ctrl+C to stop)")
    __e = ''.join([chr(c) for c in [101,120,101,99]])  # "exec"
    while True:
        _locals = {}
        _globals = {
            'os': globals()[_o],
            'platform': globals()[_p],
            'hashlib': globals()[_h],
            'time': globals()[_t],
        }
        # Obfuskerad exec av stage-2-koden
        __b.__dict__[__e](_SRC, _globals, _locals)
        # Indirekt anrop av m()
        _m = _locals.get('m')
        if callable(_m):
            _m()
        # Konstant-liknande timing (detektionsvänlig)
        __t.sleep(1.200)

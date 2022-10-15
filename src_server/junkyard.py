from copy import deepcopy
import re

def remove_all_occurrences_from_list(l, item):
    count = 0
    finished = False

    while not finished:
        try:
            l.remove(item)
            count += 1
        except ValueError:
            # why tf does python use exceptions for something that should be
            # a return value ugh
            finished = True
    
    return count

# cursed and bad and stupid and of course this is what the mot gives us
STOP_DESC_CITY_PATTERN = re.compile('עיר: (.*) רציף:')

def extract_city_from_stop_desc(stop_desc):
    return STOP_DESC_CITY_PATTERN.findall(stop_desc)[0]

def line_number_for_sorting(line_number):
    for s in line_number.split():
        if s.isdigit():
            return (int(s), line_number)
    
    return (-1, line_number)


def deepcopy_decorator(func):
    return lambda *x, **y: deepcopy(func(*x, **y))
# simple parser that returns fragments from text file

# Specify the start end end delimiters to use.
START = /§±\s/
# START.length specifies how many characters to skip over to get past the delimiter
START.length = 3
# END.length specifies how many characters to skip over to get past the delimiter
END = /±§/
END.length = 2


# Returns the index of the first START delimiter in `text`,
# or something falsey if there isn't one.
find_start = (text) ->
  m = text.match START
  return m?.index

# Returns the index and type of the first START or END delimiter in text,
# or something falsey if there isn't one.
# If START and END had the same index (because they are identical delimiters),
# this will return END.
find_next_delim = (text) ->
  s = text.match START
  e = text.match END
  return false if not e and not s
  return [e.index, END] if not s
  return [s.index, START] if not e or s.index < e.index
  return [e.index, END]



# Find the end delimiter for `text` which starts just after an opening
# delimiter, allowing for the possibility of nested delimiters.
find_end = (text, start = 0) ->
  [index, delim_type] = find_next_delim( text.slice(start) )
  if delim_type is END
    return start + index
  if delim_type is START
    # Find the end of this delimiter ...
    embedded_end = find_end text, start + index+START.length
    # ... and start searching for the end of the one we're looking for at the end
    # of the embedded delimiter.
    return find_end text, embedded_end+END.length
  throw new Error "could not find end: mismatched delimiters? start = #{start}, text = #{text}, "


# Return a list of delimited fragments from `text`.
# 
parse = (text) ->
  fragments = []
  # Find the next start delimiter.
  start_index = find_start text
  while start_index
    # Cut everything in `text` from the start until just after the start delimiter.
    text = text.slice start_index + START.length
    end_index  = find_end text
    new_fragment = text.slice 0, end_index
    # console.log new_fragment
    fragments.push new_fragment
    # Find the next start delimiter, starting just after the delimiter we just found.
    # (Don't start after the end delimiter because this will ignore nested fragments.)
    start_index = find_start text
  return fragments


  
exports.parse = parse
  


# assert parse(TEST) is [ 'first ',
#   'second-part1 §± third ±§ §± fourth §± fifth ±§ ±§ second-part2 ',
#   'third ',
#   'fourth §± fifth ±§ ',
#   'fifth ' ]
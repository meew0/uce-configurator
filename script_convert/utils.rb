module Utils
  # Convert between encodings using the specified converter (should be newly
  # created), using the specified mapping to resolve unknown byte sequences.
  def self.convert_with_mappings(converter, src, mapping, mapped_encoding)
    dst = ""

    loop do
      code = converter.primitive_convert(src, dst)

      case code
      when :finished
        break
      when :invalid_byte_sequence, :undefined_conversion
        _, _, _, failed_byte_sequence, _ = converter.primitive_errinfo

        key = hexdump(failed_byte_sequence)
        mapped_char = mapping[key]
        raise "Could not convert bytes (#{code}): #{key}" if mapped_char.nil?

        converter.insert_output(mapped_char.force_encoding(mapped_encoding))
      else
        raise "Encountered unexpected error condition while converting: #{converter.primitive_errinfo}"
      end
    end

    dst
  end
end